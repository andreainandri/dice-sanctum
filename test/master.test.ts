// Le prove dei dadi del master sul ponte, senza browser e senza server MCP: il lancio in chiaro con la
// ripresa per il tavolo, il lancio dietro lo schermo, nessun tavolo collegato, le richieste aperte che
// un tiro del master non tocca, il riavvio a metà.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { type Ponte } from '../src/bridge/ponte.ts';
import { RipresaLetta } from '../src/physics/ripresa.ts';
import { geometria } from '../src/shared/dadi.ts';
import { type Evento, type TiroCoperto, type TiroDelMaster } from '../src/shared/eventi.ts';
import { leggi } from '../src/shared/lettura.ts';
import {
  type DalFeed,
  type DalPonte,
  PAUSA_DOPO_IL_MASTER,
  type RispostaAttesa,
  type RispostaStato,
  type RispostaTiriDelMaster,
} from '../src/shared/protocollo.ts';
import { TavoloDiProva, accendiPonte, cartellaDiProva, dormi, tiro } from './aiuti.ts';

/** Le attese delle riprese, nelle prove, durano un ventesimo del vero. */
const RITMO = 0.05;

function chiama(porta: number, metodo: 'GET' | 'POST', percorso: string, dato?: unknown): Promise<{ codice: number; json: Record<string, unknown> }> {
  return new Promise((ok, ko) => {
    const corpo = dato === undefined ? undefined : JSON.stringify(dato);
    const req = request(
      {
        host: '127.0.0.1',
        port: porta,
        method: metodo,
        path: percorso,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(corpo)) },
      },
      (res) => {
        const pezzi: Buffer[] = [];
        res.on('data', (p: Buffer) => pezzi.push(p));
        res.on('end', () => ok({ codice: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(pezzi).toString()) as Record<string, unknown> }));
      },
    );
    req.on('error', ko);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

const tiraIlMaster = async (porta: number, tiri: { formula: string; label: string }[], segreto?: boolean) => {
  const r = await chiama(porta, 'POST', '/api/master/tiri', segreto === undefined ? { tiri } : { tiri, segreto });
  assert.equal(r.codice, 200, JSON.stringify(r.json));
  return r.json as unknown as RispostaTiriDelMaster;
};

const righeDelRegistro = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((r) => r !== '')
    .map((r) => JSON.parse(r) as Evento);

/** Tutto quello che il ponte manda a un tavolo, testo per testo, compreso quello che la prova ha già letto. */
function ascoltaTutto(t: TavoloDiProva): string[] {
  const testi: string[] = [];
  t.ws.on('message', (d) => testi.push(d.toString()));
  return testi;
}

describe('i dadi del master', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let tavolo: TavoloDiProva;
  let visti: string[];

  before(async () => {
    ponte = await accendiPonte(dir.registro, dir.client, 0, { ritmoDelleRiprese: RITMO });
    P = ponte.porta;
  });
  after(async () => {
    await tavolo?.chiudi();
    await ponte.ferma();
    dir.via();
  });

  it('senza tavolo collegato il master tira lo stesso, subito, e nessuno l’ha visto', async () => {
    const r = await tiraIlMaster(P, [{ formula: '1d20+4', label: 'Lupo, morso sul paladino' }]);
    assert.equal(r.visto, false);
    assert.equal(r.tiri.length, 1);
    const t = r.tiri[0]!;
    assert.deepEqual(Object.keys(t), ['v', 'seq', 'type', 'id', 'at', 'throwId', 'secret', 'shown', 'summary', 'label', 'formula', 'groups', 'constant', 'total', 'nat20', 'nat1']);
    assert.equal(t.type, 'dm.roll.completed');
    assert.equal(t.seq, 1);
    assert.equal(t.secret, false);
    assert.equal(t.shown, false);
    assert.equal(t.label, 'Lupo, morso sul paladino');
    assert.equal(t.formula, '1d20+4');
    const dado = t.groups[0]!.dice[0]!.value;
    assert.ok(Number.isInteger(dado) && dado >= 1 && dado <= 20, `dado ${dado}`);
    assert.equal(t.total, dado + 4);
    assert.equal(t.nat20, dado === 20);
    assert.equal(t.nat1, dado === 1);
    assert.equal(t.summary, `Lupo, morso sul paladino 1d20+4: [${dado}] +4 = ${dado + 4}`);
    assert.deepEqual(righeDelRegistro(dir.registro), [t]);
  });

  it('un lancio in chiaro: il tavolo riceve i tiri e la ripresa, e i dadi della ripresa si fermano sui numeri del registro', async () => {
    tavolo = await TavoloDiProva.apri(P);
    visti = ascoltaTutto(tavolo);
    const inizio = Date.now();
    const risposta = tiraIlMaster(P, [
      { formula: '1d20+4', label: 'Lupo, morso' },
      { formula: '2d6+2', label: 'Lupo, danno' },
    ]);
    const m = await tavolo.aspetta<Extract<DalPonte, { tipo: 'lancio del master' }>>((x) => x.tipo === 'lancio del master');
    const r = await risposta;
    const durata = Date.now() - inizio;

    assert.equal(r.visto, true);
    assert.deepEqual(m.tiri, r.tiri);
    assert.deepEqual(r.tiri.map((t) => t.seq), [2, 3]);
    assert.deepEqual(r.tiri.map((t) => t.shown), [true, true]);
    assert.equal(r.tiri[0]!.throwId, r.tiri[1]!.throwId);
    assert.notEqual(r.tiri[0]!.id, r.tiri[1]!.id);
    assert.deepEqual(righeDelRegistro(dir.registro).slice(1), r.tiri);

    // I dadi in ordine di formula: il d20, poi i due d6.
    assert.deepEqual(m.ripresa.dadi, [
      { forma: 'd20', ruolo: 'semplice' },
      { forma: 'd6', ruolo: 'semplice' },
      { forma: 'd6', ruolo: 'semplice' },
    ]);
    const letta = new RipresaLetta(m.ripresa);
    const ultimo = m.ripresa.fotogrammi - 1;
    const faccia = (i: number) => leggi(geometria(m.ripresa.dadi[i]!.forma), letta.posa(ultimo, i).q).lettura;
    assert.equal(faccia(0), r.tiri[0]!.groups[0]!.dice[0]!.value);
    assert.deepEqual([faccia(1), faccia(2)], r.tiri[1]!.groups[0]!.dice.map((d) => d.value));

    // La risposta parte quando il tavolo ha visto la ripresa fino in fondo, pausa compresa.
    const attesa = (letta.durata * 1000 + PAUSA_DOPO_IL_MASTER) * RITMO;
    assert.ok(durata >= attesa - 5, `risposta dopo ${durata} ms, la ripresa ne chiede ${attesa.toFixed(0)}`);
  });

  it('due lanci in chiaro insieme: la risposta del secondo aspetta anche il primo', async () => {
    const inizio = Date.now();
    const a = tiraIlMaster(P, [{ formula: '1d20', label: 'Primo' }]);
    const b = tiraIlMaster(P, [{ formula: '1d20', label: 'Secondo' }]);
    const ma = await tavolo.aspetta<Extract<DalPonte, { tipo: 'lancio del master' }>>((x) => x.tipo === 'lancio del master');
    const mb = await tavolo.aspetta<Extract<DalPonte, { tipo: 'lancio del master' }>>((x) => x.tipo === 'lancio del master');
    await Promise.all([a, b]);
    const durata = Date.now() - inizio;
    const insieme = [ma, mb].reduce((s, m) => s + (new RipresaLetta(m.ripresa).durata * 1000 + PAUSA_DOPO_IL_MASTER) * RITMO, 0);
    assert.ok(durata >= insieme - 5, `due risposte in ${durata} ms, le due riprese ne chiedono ${insieme.toFixed(0)}`);
    assert.deepEqual([ma.tiri[0]!.seq, mb.tiri[0]!.seq], [4, 5]);
  });

  it('un lancio dietro lo schermo: al tavolo arriva soltanto che il master ha tirato', async () => {
    const r = await tiraIlMaster(
      P,
      [
        { formula: '1d20+6', label: 'Furtività della cosa nel pozzo' },
        { formula: '1d20+1', label: 'Percezione passiva contro' },
      ],
      true,
    );
    assert.equal(r.visto, false);
    assert.deepEqual(r.tiri.map((t) => t.secret), [true, true]);
    assert.deepEqual(r.tiri.map((t) => t.shown), [false, false]);
    assert.deepEqual(r.tiri.map((t) => t.seq), [6, 7]);

    const m = await tavolo.aspetta<Extract<DalPonte, { tipo: 'evento' }>>((x) => x.tipo === 'evento' && x.evento.type === 'dm.roll.hidden');
    const coperto = m.evento as TiroCoperto;
    // Una voce sola per il lancio, e dentro niente che dica cosa o quanto.
    assert.deepEqual(coperto, { v: 1, seq: 6, type: 'dm.roll.hidden', id: r.tiri[0]!.id, at: r.tiri[0]!.at, throwId: r.tiri[0]!.throwId });
    await assert.rejects(tavolo.aspetta((x) => x.tipo === 'lancio del master' || (x.tipo === 'evento' && x.evento.type === 'dm.roll.hidden'), 150));

    // Nel registro il tiro c'è tutto: è lì che il DM lo ritrova.
    const righe = righeDelRegistro(dir.registro);
    assert.deepEqual(righe.slice(-2), r.tiri);
    assert.equal((righe.at(-1) as TiroDelMaster).label, 'Percezione passiva contro');
  });

  it('niente di quello che il ponte ha mandato al tavolo nomina il tiro segreto', () => {
    const tutto = visti.join('\n');
    assert.ok(tutto.includes('Lupo, morso'), 'i tiri in chiaro al tavolo arrivano');
    assert.ok(!tutto.includes('Furtività'));
    assert.ok(!tutto.includes('Percezione passiva'));
    assert.ok(!tutto.includes('1d20+6'));
  });

  it('chi si collega dopo trova in cronaca i tiri del master, e i segreti coperti, una voce per lancio', async () => {
    const altro = await TavoloDiProva.apri(P);
    const cronaca = altro.stato.cronaca;
    assert.deepEqual(cronaca.map((v) => [v.seq, v.type]), [
      [1, 'dm.roll.completed'],
      [2, 'dm.roll.completed'],
      [3, 'dm.roll.completed'],
      [4, 'dm.roll.completed'],
      [5, 'dm.roll.completed'],
      [6, 'dm.roll.hidden'],
    ]);
    assert.deepEqual(Object.keys(cronaca[5]!), ['v', 'seq', 'type', 'id', 'at', 'throwId']);
    assert.ok(!JSON.stringify(altro.stato).includes('Furtività'));
    assert.equal(altro.stato.ultimoSeq, 7);
    await altro.chiudi();
  });

  it('un tiro del master non soddisfa una richiesta aperta, nemmeno con la stessa formula', async () => {
    const chiesta = await chiama(P, 'POST', '/api/richieste', { formula: '1d20+3', label: 'Salvezza su Costituzione' });
    assert.equal(chiesta.codice, 200, JSON.stringify(chiesta.json));
    const requestId = (chiesta.json.richiesta as { requestId: string }).requestId;
    await tavolo.aspetta((x) => x.tipo === 'evento' && x.evento.type === 'request.created');

    const attesa = chiama(P, 'POST', `/api/richieste/${requestId}/attendi`, { secondi: 1 });
    await dormi(30);
    await tiraIlMaster(P, [{ formula: '1d20+3', label: 'Salvezza su Costituzione' }]);
    await tiraIlMaster(P, [{ formula: '1d20+3', label: 'Salvezza su Costituzione' }], true);
    const esito = (await attesa).json as unknown as RispostaAttesa;
    assert.equal(esito.stato, 'in attesa');
    const stato = (await chiama(P, 'GET', '/api/stato')).json as unknown as RispostaStato;
    assert.deepEqual(stato.richiesteAperte.map((r) => r.requestId), [requestId]);

    // La chiude soltanto il tiro del tavolo.
    const ricevuto = await tavolo.tira(tiro('1d20+3', [[11]], { requestId, label: 'Salvezza su Costituzione' }));
    assert.equal(ricevuto.tipo, 'ricevuto');
    const dopo = (await chiama(P, 'GET', '/api/stato')).json as unknown as RispostaStato;
    assert.deepEqual(dopo.richiesteAperte, []);
  });

  it('il feed riceve i tiri del master, segreti compresi, mai segnati come consegnati', async () => {
    const feed = new WebSocket(`ws://127.0.0.1:${P}/feed?da=${ponte.registro.ultimoSeq}`);
    const righe: DalFeed[] = [];
    feed.on('message', (d) => righe.push(JSON.parse(d.toString()) as DalFeed));
    await new Promise((ok) => feed.once('open', ok));
    const chiaro = await tiraIlMaster(P, [{ formula: '1d8', label: 'Danno' }]);
    const segreto = await tiraIlMaster(P, [{ formula: '1d20', label: 'Dietro lo schermo' }], true);
    const fine = Date.now() + 2000;
    while (righe.length < 2 && Date.now() < fine) await dormi(10);
    assert.deepEqual(righe, [
      { evento: chiaro.tiri[0], consegnato: false },
      { evento: segreto.tiri[0], consegnato: false },
    ]);
    feed.terminate();
  });

  it('richieste storte: nessuna scrive nel registro', async () => {
    const prima = ponte.registro.ultimoSeq;
    const storte: [unknown, RegExp][] = [
      [{}, /tiri must be a list/],
      [{ tiri: [] }, /at least one roll/],
      [{ tiri: 'x' }, /tiri must be a list/],
      [{ tiri: Array.from({ length: 9 }, () => ({ formula: '1d6', label: 'x' })) }, /at most 8 rolls/],
      [{ tiri: [{ formula: '1d20', label: 'ok' }, { formula: '1d7', label: 'storta' }] }, /^roll 2: /],
      [{ tiri: [{ formula: '1d20' }] }, /roll 1: the label is missing/],
      [{ tiri: [{ formula: '1d20', label: '   ' }] }, /roll 1: the label is missing/],
      [{ tiri: [{ formula: '1d20', label: 'x'.repeat(81) }] }, /over 80 characters/],
      [{ tiri: [{ label: 'senza formula' }] }, /roll 1: the formula is missing/],
      [{ tiri: ['1d20'] }, /roll 1: an object/],
      [{ tiri: [{ formula: '1d20', label: 'x' }], segreto: 'sì' }, /segreto must be true or false/],
      [{ tiri: Array.from({ length: 4 }, () => ({ formula: '8d6', label: 'palla di fuoco' })) }, /32 dice in one throw: at most 30/],
    ];
    for (const [dato, motivo] of storte) {
      const r = await chiama(P, 'POST', '/api/master/tiri', dato);
      assert.equal(r.codice, 400, JSON.stringify(dato));
      assert.match(String(r.json.errore), motivo);
    }
    assert.equal(ponte.registro.ultimoSeq, prima);
  });

  it('trenta dadi in un lancio solo, ognuno col suo conto', async () => {
    const r = await tiraIlMaster(P, [
      { formula: '8d6', label: 'Palla di fuoco' },
      { formula: '2d20kl1+5', label: 'Salvezza con svantaggio' },
      { formula: '1d100', label: 'Tabella' },
      { formula: '10d10', label: 'Caduta' },
      { formula: '8d4+8', label: 'Dardi' },
    ]);
    assert.equal(r.tiri.length, 5);
    const somma = (t: TiroDelMaster) => t.groups.reduce((s, g) => s + g.sign * g.dice.filter((d) => d.kept).reduce((a, d) => a + d.value, 0), 0) + t.constant;
    for (const t of r.tiri) assert.equal(t.total, somma(t), t.summary);
    assert.deepEqual(r.tiri.map((t) => t.groups[0]!.dice.length), [8, 2, 1, 10, 8]);
    assert.equal(r.tiri[1]!.groups[0]!.dice.filter((d) => d.kept).length, 1);
    const cento = r.tiri[2]!.groups[0]!.dice[0]!;
    assert.ok(cento.value >= 1 && cento.value <= 100 && cento.tens !== undefined && cento.units !== undefined);
    await tavolo.aspetta((x) => x.tipo === 'lancio del master' && x.tiri[0]!.label === 'Palla di fuoco');
  });
});

describe('i dadi del master e il ponte che si ferma', () => {
  const dir = cartellaDiProva();

  after(() => dir.via());

  it('fermato a metà di una ripresa, il ponte risponde subito al DM; riacceso, ritrova i tiri e tiene coperti i segreti', async () => {
    // Col ritmo vero la risposta aspetterebbe più di un secondo: la sblocca la fermata.
    let ponte = await accendiPonte(dir.registro, dir.client);
    const porta = ponte.porta;
    let tavolo = await TavoloDiProva.apri(porta);
    const segreto = await tiraIlMaster(porta, [{ formula: '1d20+2', label: 'Iniziativa nascosta' }], true);
    const inizio = Date.now();
    const risposta = tiraIlMaster(porta, [{ formula: '1d20+5', label: 'Attacco' }]);
    await tavolo.aspetta((x) => x.tipo === 'lancio del master');
    await ponte.ferma();
    const r = await risposta;
    assert.ok(Date.now() - inizio < 600, `risposta in ${Date.now() - inizio} ms`);
    assert.equal(r.visto, true);
    await tavolo.chiudi();

    ponte = await accendiPonte(dir.registro, dir.client, porta);
    try {
      assert.equal(ponte.registro.ultimoSeq, 2);
      tavolo = await TavoloDiProva.apri(porta);
      assert.deepEqual(tavolo.stato.cronaca, [
        { v: 1, seq: 1, type: 'dm.roll.hidden', id: segreto.tiri[0]!.id, at: segreto.tiri[0]!.at, throwId: segreto.tiri[0]!.throwId },
        r.tiri[0],
      ]);
      const dopo = await tiraIlMaster(porta, [{ formula: '1d6', label: 'Dopo il riavvio' }], true);
      assert.equal(dopo.tiri[0]!.seq, 3);
      const eventi = (await chiama(porta, 'GET', '/api/eventi?da=0')).json as unknown as { eventi: Evento[] };
      assert.deepEqual(eventi.eventi.map((e) => e.type), ['dm.roll.completed', 'dm.roll.completed', 'dm.roll.completed']);
      await tavolo.chiudi();
    } finally {
      await ponte.ferma();
    }
  });
});
