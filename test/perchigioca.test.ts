// Le prove dei tiri che il master fa al posto di chi gioca, sul ponte, senza browser e senza server MCP:
// nel registro sono tiri di chi gioca segnati col master, il tavolo ne riceve la ripresa da mostrare coi
// dadi di chi gioca, non chiudono nessuna richiesta e al feed arrivano già consegnati.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { type Ponte } from '../src/bridge/ponte.ts';
import { RipresaLetta } from '../src/physics/ripresa.ts';
import { geometria } from '../src/shared/dadi.ts';
import { type Evento } from '../src/shared/eventi.ts';
import { leggi } from '../src/shared/lettura.ts';
import { type DalFeed, type DalPonte, PAUSA_DOPO_IL_MASTER, type RispostaStato, type RispostaTiriPerChiGioca } from '../src/shared/protocollo.ts';
import { TavoloDiProva, accendiPonte, cartellaDiProva, dormi, tiro } from './aiuti.ts';

/** Le attese delle riprese, nelle prove, durano un ventesimo del vero. */
const RITMO = 0.05;

async function chiama(porta: number, metodo: 'GET' | 'POST', percorso: string, dato?: unknown): Promise<{ codice: number; json: Record<string, unknown> }> {
  const r = await fetch(`http://127.0.0.1:${porta}${percorso}`, {
    method: metodo,
    headers: dato === undefined ? {} : { 'Content-Type': 'application/json' },
    body: dato === undefined ? undefined : JSON.stringify(dato),
  });
  return { codice: r.status, json: (await r.json()) as Record<string, unknown> };
}

const tiraPerChiGioca = async (porta: number, tiri: { formula: string; label: string }[]) => {
  const r = await chiama(porta, 'POST', '/api/giocatore/tiri', { tiri });
  assert.equal(r.codice, 200, JSON.stringify(r.json));
  return r.json as unknown as RispostaTiriPerChiGioca;
};

const righeDelRegistro = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((r) => r !== '')
    .map((r) => JSON.parse(r) as Evento);

type Lancio = Extract<DalPonte, { tipo: 'lancio per chi gioca' }>;
const lancio = (t: TavoloDiProva) => t.aspetta<Lancio>((m) => m.tipo === 'lancio per chi gioca');

describe('il master tira al posto di chi gioca', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let tavolo: TavoloDiProva;
  const visti: string[] = [];

  before(async () => {
    ponte = await accendiPonte(dir.registro, dir.client, 0, { ritmoDelleRiprese: RITMO });
    P = ponte.porta;
  });
  after(async () => {
    await tavolo?.chiudi();
    await ponte.ferma();
    dir.via();
  });

  it('senza tavolo collegato tira lo stesso, subito: nel registro è un tiro libero di chi gioca, segnato col master', async () => {
    const r = await tiraPerChiGioca(P, [{ formula: '1d20 + 5', label: 'Percezione' }]);
    assert.equal(r.visto, false);
    assert.deepEqual(r.richiesteAperte, []);
    assert.equal(r.tiri.length, 1);
    const t = r.tiri[0]!;
    assert.deepEqual(Object.keys(t), [
      'v',
      'seq',
      'type',
      'id',
      'at',
      'summary',
      'label',
      'formula',
      'requestId',
      'groups',
      'constant',
      'total',
      'nat20',
      'nat1',
      'rolledBy',
      'throwId',
      'shown',
    ]);
    assert.equal(t.type, 'roll.completed');
    assert.equal(t.seq, 1);
    assert.equal(t.requestId, null);
    assert.equal(t.rolledBy, 'dm');
    assert.equal(t.shown, false);
    assert.equal(t.formula, '1d20+5');
    const dado = t.groups[0]!.dice[0]!.value;
    assert.ok(Number.isInteger(dado) && dado >= 1 && dado <= 20, `dado ${dado}`);
    assert.equal(t.total, dado + 5);
    assert.equal(t.summary, `Percezione 1d20+5: [${dado}] +5 = ${dado + 5}`);
    assert.deepEqual(righeDelRegistro(dir.registro), [t]);
  });

  it('col tavolo collegato: arrivano i tiri e la ripresa, i dadi si fermano sui numeri del registro, e la risposta aspetta la ripresa', async () => {
    tavolo = await TavoloDiProva.apri(P);
    tavolo.ws.on('message', (d) => visti.push(d.toString()));
    const inizio = Date.now();
    const risposta = tiraPerChiGioca(P, [
      { formula: '1d20+6', label: 'Spada lunga, attacco' },
      { formula: '1d8+4', label: 'Spada lunga, danno' },
    ]);
    const m = await lancio(tavolo);
    const r = await risposta;
    const durata = Date.now() - inizio;

    assert.equal(r.visto, true);
    assert.deepEqual(m.tiri, r.tiri);
    assert.deepEqual(r.tiri.map((t) => [t.seq, t.type, t.rolledBy, t.shown, t.requestId]), [
      [2, 'roll.completed', 'dm', true, null],
      [3, 'roll.completed', 'dm', true, null],
    ]);
    assert.equal(r.tiri[0]!.throwId, r.tiri[1]!.throwId);
    assert.notEqual(r.tiri[0]!.id, r.tiri[1]!.id);
    assert.deepEqual(righeDelRegistro(dir.registro).slice(1), r.tiri);

    assert.deepEqual(m.ripresa.dadi, [
      { forma: 'd20', ruolo: 'semplice' },
      { forma: 'd8', ruolo: 'semplice' },
    ]);
    const letta = new RipresaLetta(m.ripresa);
    const ultimo = m.ripresa.fotogrammi - 1;
    const faccia = (i: number) => leggi(geometria(m.ripresa.dadi[i]!.forma), letta.posa(ultimo, i).q).lettura;
    assert.equal(faccia(0), r.tiri[0]!.groups[0]!.dice[0]!.value);
    assert.equal(faccia(1), r.tiri[1]!.groups[0]!.dice[0]!.value);

    const attesa = (letta.durata * 1000 + PAUSA_DOPO_IL_MASTER) * RITMO;
    assert.ok(durata >= attesa - 5, `risposta dopo ${durata} ms, la ripresa ne chiede ${attesa.toFixed(0)}`);
  });

  it('al tavolo il lancio arriva una volta sola, con la ripresa: nessun evento a parte per quei tiri', () => {
    const messaggi = visti.map((x) => JSON.parse(x) as DalPonte);
    assert.equal(messaggi.filter((m) => m.tipo === 'lancio per chi gioca').length, 1);
    assert.deepEqual(messaggi.filter((m) => m.tipo === 'evento' || m.tipo === 'lancio del master'), []);
  });

  it('non soddisfa una richiesta aperta, nemmeno con la stessa formula, e la risposta dice che è rimasta sul tavolo', async () => {
    const chiesta = await chiama(P, 'POST', '/api/richieste', { formula: '1d20+3', label: 'Salvezza su Costituzione' });
    assert.equal(chiesta.codice, 200, JSON.stringify(chiesta.json));
    const requestId = (chiesta.json.richiesta as { requestId: string }).requestId;
    await tavolo.aspetta((x) => x.tipo === 'evento' && x.evento.type === 'request.created');

    const r = await tiraPerChiGioca(P, [{ formula: '1d20+3', label: 'Salvezza su Costituzione' }]);
    await lancio(tavolo);
    assert.deepEqual(r.richiesteAperte.map((x) => x.requestId), [requestId]);
    const stato = (await chiama(P, 'GET', '/api/stato')).json as unknown as RispostaStato;
    assert.deepEqual(stato.richiesteAperte.map((x) => x.requestId), [requestId]);

    // La chiude il tiro del tavolo, come sempre.
    const ricevuto = await tavolo.tira(tiro('1d20+3', [[11]], { requestId, label: 'Salvezza su Costituzione' }));
    assert.equal(ricevuto.tipo, 'ricevuto');
    assert.deepEqual(((await chiama(P, 'GET', '/api/stato')).json as unknown as RispostaStato).richiesteAperte, []);
  });

  it('il feed li riceve già consegnati: sono usciti nella risposta alla chiamata del DM', async () => {
    const feed = new WebSocket(`ws://127.0.0.1:${P}/feed?dopo=${ponte.registro.ultimoSeq}`);
    const righe: DalFeed[] = [];
    feed.on('message', (d) => righe.push(JSON.parse(d.toString()) as DalFeed));
    await new Promise((ok) => feed.once('open', ok));
    const r = await tiraPerChiGioca(P, [{ formula: '2d6', label: 'Danno' }]);
    await lancio(tavolo);
    const libero = await tavolo.tira(tiro('1d20', [[9]]));
    assert.equal(libero.tipo, 'ricevuto');
    const fine = Date.now() + 2000;
    while (righe.length < 2 && Date.now() < fine) await dormi(10);
    assert.deepEqual(righe.map((x) => [x.evento.seq, x.consegnato]), [
      [r.tiri[0]!.seq, true],
      [r.tiri[0]!.seq + 1, false],
    ]);
    assert.deepEqual(righe[0]!.evento, r.tiri[0]);
    feed.terminate();
  });

  it('il tavolo non può darsi da solo un tiro del master: i campi in più non entrano nel registro', async () => {
    const finto = { ...tiro('1d20', [[20]], { label: 'Finto' }), rolledBy: 'dm', throwId: 'x', shown: true };
    const ricevuto = await tavolo.tira(finto as ReturnType<typeof tiro>);
    assert.equal(ricevuto.tipo, 'ricevuto');
    const scritto = righeDelRegistro(dir.registro).at(-1)!;
    assert.equal(scritto.type, 'roll.completed');
    assert.deepEqual(Object.keys(scritto), ['v', 'seq', 'type', 'id', 'at', 'summary', 'label', 'formula', 'requestId', 'groups', 'constant', 'total', 'nat20', 'nat1']);
  });

  it('richieste storte: nessuna scrive nel registro', async () => {
    const prima = ponte.registro.ultimoSeq;
    const storte: [unknown, RegExp][] = [
      [{}, /tiri must be a list/],
      [{ tiri: [] }, /tiri must be a list/],
      [{ tiri: [{ formula: '1d20' }] }, /the label is missing: what the character rolls/],
      [{ tiri: [{ formula: '2d7', label: 'Storta' }] }, /roll 1: /],
      [{ tiri: [{ formula: '1d20', label: 'Di nascosto' }], segreto: true }, /never secret/],
      [{ tiri: [{ formula: '1d20', label: 'Di nascosto' }], segreto: false }, /never secret/],
      [{ tiri: Array.from({ length: 9 }, () => ({ formula: '1d20', label: 'Troppi' })) }, /at most 8 rolls/],
      [{ tiri: [{ formula: '31d6', label: 'Troppi dadi' }] }, /./],
    ];
    for (const [corpo, motivo] of storte) {
      const r = await chiama(P, 'POST', '/api/giocatore/tiri', corpo);
      assert.equal(r.codice, 400, JSON.stringify(corpo));
      assert.match(String(r.json.errore), motivo);
    }
    assert.equal(ponte.registro.ultimoSeq, prima);
  });

  it('chi si collega dopo, e il ponte riacceso, li trovano in cronaca come tiri di chi gioca segnati col master', async () => {
    const attesi = righeDelRegistro(dir.registro).filter((e) => e.type === 'roll.completed' && e.rolledBy === 'dm');
    assert.equal(attesi.length, 5);
    const dopo = await TavoloDiProva.apri(P);
    assert.deepEqual(dopo.stato.cronaca.filter((e) => e.type === 'roll.completed' && e.rolledBy === 'dm'), attesi);
    await dopo.chiudi();

    await tavolo.chiudi();
    await ponte.ferma();
    ponte = await accendiPonte(dir.registro, dir.client, 0, { ritmoDelleRiprese: RITMO });
    P = ponte.porta;
    tavolo = await TavoloDiProva.apri(P);
    assert.deepEqual(tavolo.stato.cronaca.filter((e) => e.type === 'roll.completed' && e.rolledBy === 'dm'), attesi);
    const r = await tiraPerChiGioca(P, [{ formula: '1d4', label: 'Dopo il riavvio' }]);
    assert.equal(r.tiri[0]!.seq, attesi.at(-1)!.seq + 3);
  });
});
