// Le prove d'integrazione del ponte, senza browser e senza server MCP: la sicurezza del §9, il
// registro, il tavolo, le richieste con le attese, il feed, il riavvio a metà.

import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { type IncomingHttpHeaders, request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { type Ponte } from '../src/bridge/ponte.ts';
import { type Evento, type EventoPerIlTavolo, type RichiestaCreata, type TiroCompletato } from '../src/shared/eventi.ts';
import { type DalFeed, type RispostaAttesa } from '../src/shared/protocollo.ts';
import { TavoloDiProva, accendiPonte, cartellaDiProva, dormi, tiro } from './aiuti.ts';

interface Risposta {
  codice: number;
  corpo: string;
  /** L'intestazione Content-Type, se c'è. */
  tipo: string | undefined;
  intestazioni: IncomingHttpHeaders;
  json: () => Record<string, unknown>;
}

/** Una richiesta HTTP grezza: le intestazioni le decide la prova, Host compreso. */
function http(
  porta: number,
  o: { metodo?: string; percorso: string; intestazioni?: Record<string, string>; corpo?: string | Buffer },
): Promise<Risposta> {
  return new Promise((ok, ko) => {
    let risposto = false;
    const req = request(
      { host: '127.0.0.1', port: porta, method: o.metodo ?? 'GET', path: o.percorso, headers: o.intestazioni ?? {} },
      (res) => {
        const pezzi: Buffer[] = [];
        res.on('data', (p: Buffer) => pezzi.push(p));
        res.on('end', () => {
          risposto = true;
          const corpo = Buffer.concat(pezzi).toString();
          ok({
            codice: res.statusCode ?? 0,
            corpo,
            tipo: res.headers['content-type'],
            intestazioni: res.headers,
            json: () => JSON.parse(corpo) as Record<string, unknown>,
          });
        });
      },
    );
    // Il ponte chiude la connessione dopo un 413 anche se il corpo non è finito di partire.
    req.on('error', (e) => {
      if (!risposto) ko(e);
    });
    if (o.corpo !== undefined) req.write(o.corpo);
    req.end();
  });
}

const posta = (porta: number, percorso: string, dato: unknown, origine?: string) =>
  http(porta, {
    metodo: 'POST',
    percorso,
    intestazioni: { 'Content-Type': 'application/json', ...(origine ? { Origin: origine } : {}) },
    corpo: JSON.stringify(dato),
  });

type Esito = { aperto: true; ws: WebSocket } | { aperto: false; codice: number };

/** Prova ad aprire un WebSocket; con un rifiuto, il codice HTTP della risposta. */
function apriWs(porta: number, percorso: string, o: { origin?: string; host?: string } = {}): Promise<Esito> {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${porta}${percorso}`, {
      ...(o.origin ? { origin: o.origin } : {}),
      headers: o.host ? { host: o.host } : {},
    });
    ws.on('open', () => ok({ aperto: true, ws }));
    ws.on('unexpected-response', (_q, res) => {
      ok({ aperto: false, codice: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on('error', () => ok({ aperto: false, codice: 0 }));
  });
}

/** Un feed di prova: le righe arrivate, in ordine. */
async function apriFeed(porta: number, query: string): Promise<{ ws: WebSocket; righe: DalFeed[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}/feed?${query}`);
  const righe: DalFeed[] = [];
  ws.on('message', (d) => righe.push(JSON.parse(d.toString()) as DalFeed));
  await new Promise<void>((ok, ko) => {
    ws.once('open', () => ok());
    ws.once('error', ko);
  });
  return { ws, righe };
}

async function finché(condizione: () => boolean, ms = 3000, cosa = 'condizione'): Promise<void> {
  const fine = Date.now() + ms;
  while (!condizione()) {
    if (Date.now() > fine) throw new Error(`${cosa}: non vera dopo ${ms} ms`);
    await dormi(10);
  }
}

const righeDelRegistro = (percorso: string): string[] => readFileSync(percorso, 'utf8').split('\n').filter((r) => r !== '');

describe('il ponte: sicurezza', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let app: string;

  before(async () => {
    ponte = await accendiPonte(dir.registro, dir.client);
    P = ponte.porta;
    app = `http://127.0.0.1:${P}`;
  });
  after(async () => {
    await ponte.ferma();
    dir.via();
  });

  it('serve la pagina e nient’altro fuori dalla sua cartella', async () => {
    const pagina = await http(P, { percorso: '/' });
    assert.equal(pagina.codice, 200);
    assert.match(pagina.corpo, /<title>prova<\/title>/);
    assert.equal(pagina.intestazioni['x-frame-options'], 'DENY');
    assert.equal(pagina.intestazioni['content-security-policy'], "frame-ancestors 'none'");
    assert.equal((await http(P, { percorso: '/..%2f..%2f..%2fetc%2fpasswd' })).codice, 403);
    assert.equal((await http(P, { percorso: '/%2e%2e%2fdati%2ftiri.jsonl' })).codice, 403);
    assert.equal((await http(P, { percorso: '/nessuno.js' })).codice, 404);
    assert.equal((await http(P, { metodo: 'POST', percorso: '/index.html' })).codice, 405);
  });

  it('serve le trame e i caratteri della pagina col loro tipo', async () => {
    writeFileSync(join(dir.client, 'trama.webp'), Buffer.from('RIFF\0\0\0\0WEBP'));
    writeFileSync(join(dir.client, 'carattere.woff2'), Buffer.from('wOF2'));
    const trama = await http(P, { percorso: '/trama.webp' });
    assert.equal(trama.codice, 200);
    assert.equal(trama.tipo, 'image/webp');
    assert.equal((await http(P, { percorso: '/carattere.woff2' })).tipo, 'font/woff2');
  });

  it('la cartella della pagina scritta con la barra finale serve lo stesso', async () => {
    const altra = cartellaDiProva();
    const secondo = await accendiPonte(altra.registro, `${altra.client}/`);
    try {
      assert.equal((await http(secondo.porta, { percorso: '/' })).codice, 200);
      assert.equal((await http(secondo.porta, { percorso: '/..%2fdati%2ftiri.jsonl' })).codice, 403);
    } finally {
      await secondo.ferma();
      altra.via();
    }
  });

  it('respinge un Host diverso da 127.0.0.1 o localhost (DNS rebinding)', async () => {
    const r = await http(P, { percorso: '/api/stato', intestazioni: { Host: `trappola.example:${P}` } });
    assert.equal(r.codice, 403);
    assert.equal((await http(P, { percorso: '/api/stato', intestazioni: { Host: `localhost:${P}` } })).codice, 200);
    const ws = await apriWs(P, '/ws', { origin: app, host: `trappola.example:${P}` });
    assert.deepEqual(ws, { aperto: false, codice: 403 });
  });

  it('l’API respinge le origini estranee', async () => {
    const stato = await http(P, { percorso: '/api/stato', intestazioni: { Origin: 'https://sito.example' } });
    assert.equal(stato.codice, 403);
    const chiesta = await posta(P, '/api/richieste', { formula: '1d20', label: 'prova' }, 'https://sito.example');
    assert.equal(chiesta.codice, 403);
    assert.equal(chiesta.json().errore, 'origin not allowed');
    // L'origine dell'app passa (e qui si ferma perché nessun tavolo è collegato).
    assert.equal((await posta(P, '/api/richieste', { formula: '1d20', label: 'prova' }, app)).codice, 409);
  });

  it('l’API vuole JSON, al massimo 64 KB, in forma di oggetto', async () => {
    const testo = await http(P, {
      metodo: 'POST',
      percorso: '/api/richieste',
      intestazioni: { 'Content-Type': 'text/plain' },
      corpo: '{"formula":"1d20","label":"prova"}',
    });
    assert.equal(testo.codice, 415);
    const modulo = await http(P, {
      metodo: 'POST',
      percorso: '/api/richieste',
      intestazioni: { 'Content-Type': 'application/x-www-form-urlencoded' },
      corpo: 'formula=1d20',
    });
    assert.equal(modulo.codice, 415);
    const grosso = await posta(P, '/api/richieste', { formula: '1d20', label: 'x'.repeat(70 * 1024) });
    assert.equal(grosso.codice, 413);
    const rotto = await http(P, {
      metodo: 'POST',
      percorso: '/api/richieste',
      intestazioni: { 'Content-Type': 'application/json' },
      corpo: '{"formula":',
    });
    assert.equal(rotto.codice, 400);
    assert.equal((await posta(P, '/api/richieste', ['1d20'])).codice, 400);
    assert.equal((await posta(P, '/api/richieste/zzz/attendi', {})).codice, 400);
    assert.equal((await posta(P, '/api/altro', {})).codice, 404);
  });

  it('il WebSocket del tavolo accetta soltanto l’origine dell’app', async () => {
    assert.deepEqual(await apriWs(P, '/ws'), { aperto: false, codice: 403 });
    assert.deepEqual(await apriWs(P, '/ws', { origin: 'https://sito.example' }), { aperto: false, codice: 403 });
    assert.deepEqual(await apriWs(P, '/altro', { origin: app }), { aperto: false, codice: 404 });
    const buono = await apriWs(P, '/ws', { origin: `http://localhost:${P}` });
    assert.equal(buono.aperto, true);
    if (buono.aperto) buono.ws.close();
  });

  it('il feed respinge le pagine estranee e accetta chi non manda Origin', async () => {
    assert.deepEqual(await apriWs(P, '/feed', { origin: 'https://sito.example' }), { aperto: false, codice: 403 });
    const mcp = await apriWs(P, '/feed');
    assert.equal(mcp.aperto, true);
    if (mcp.aperto) mcp.ws.close();
  });

  it('il tavolo: un messaggio oltre i 64 KB chiude il collegamento', async () => {
    const t = await TavoloDiProva.apri(P);
    const chiuso = new Promise<number>((ok) => t.ws.once('close', (codice) => ok(codice)));
    t.ws.send(JSON.stringify({ tipo: 'tiro', evento: { riempitivo: 'x'.repeat(65 * 1024) } }));
    assert.equal(await chiuso, 1009);
  });

  it('il tavolo: il ponte rifà il conto e respinge quello che non torna', async () => {
    const t = await TavoloDiProva.apri(P);
    const trentuno = { ...tiro('1d6', [[6]]), formula: '31d6' };
    const r1 = await t.tira(trentuno);
    assert.equal(r1.tipo, 'respinto');
    assert.match((r1 as { motivo: string }).motivo, /invalid formula/);

    const truccato = { ...tiro('1d20+3', [[12]]), total: 20 };
    const r2 = await t.tira(truccato);
    assert.equal(r2.tipo, 'respinto');
    assert.match((r2 as { motivo: string }).motivo, /wrong total: the dice give 15/);

    const fuori = tiro('1d6', [[6]]);
    fuori.groups[0]!.dice[0]!.value = 7;
    const r3 = await t.tira(fuori);
    assert.equal(r3.tipo, 'respinto');

    const storta = { ...tiro('1d20+3', [[12]]), formula: '1D20 + 3' };
    const r4 = await t.tira(storta);
    assert.match((r4 as { motivo: string }).motivo, /canonical form/);

    t.ws.send('non è JSON');
    const r5 = await t.aspetta((m) => m.tipo === 'respinto' && m.motivo === 'the message is not JSON');
    assert.equal(r5.tipo, 'respinto');
    t.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    await t.aspetta((m) => m.tipo === 'respinto' && m.motivo === 'binary message');

    assert.equal(ponte.registro.ultimoSeq, 0, 'niente di respinto entra nel registro');
    await t.chiudi();
  });
});

describe('il ponte: registro, tavolo e richieste', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let tavolo: TavoloDiProva;
  let primo: TiroCompletato;

  before(async () => {
    ponte = await accendiPonte(dir.registro, dir.client);
    P = ponte.porta;
  });
  after(async () => {
    await tavolo?.chiudi();
    await ponte.ferma();
    dir.via();
  });

  /** L'evento che il ponte diffonde ai tavoli, per tipo e per id o requestId. */
  const evento = <T extends Evento>(t: TavoloDiProva, criterio: (e: EventoPerIlTavolo) => boolean) =>
    t.aspetta((m) => m.tipo === 'evento' && criterio(m.evento)).then((m) => (m as unknown as { evento: T }).evento);

  it('senza tavolo collegato una richiesta è un errore chiaro', async () => {
    const r = await posta(P, '/api/richieste', { formula: '1d20+3', label: 'Salvezza su Costituzione' });
    assert.equal(r.codice, 409);
    assert.match(String(r.json().errore), /no table connected/);
    assert.equal(ponte.registro.ultimoSeq, 0);
  });

  it('due tiri di fila: seq in ordine, righe compatte col seq dopo la v', async () => {
    tavolo = await TavoloDiProva.apri(P);
    assert.deepEqual(tavolo.stato, { tipo: 'stato', ultimoSeq: 0, richieste: [], cronaca: [], dadiDelMaster: 'sangue' });
    const a = tiro('1d20+5', [[17]], { label: 'Percezione' });
    const b = tiro('2d6', [[3, 4]]);
    const ra = await tavolo.tira(a);
    const rb = await tavolo.tira(b);
    assert.deepEqual(ra, { tipo: 'ricevuto', id: a.id, seq: 1, doppione: false });
    assert.deepEqual(rb, { tipo: 'ricevuto', id: b.id, seq: 2, doppione: false });
    primo = await evento<TiroCompletato>(tavolo, (e) => e.type === 'roll.completed' && e.id === a.id);
    assert.equal(primo.seq, 1);
    assert.equal(primo.summary, 'Percezione 1d20+5: [17] +5 = 22');
    const righe = righeDelRegistro(dir.registro);
    assert.equal(righe.length, 2);
    assert.match(righe[0]!, /^\{"v":1,"seq":1,"type":"roll\.completed","id":"/);
    assert.ok(!righe[0]!.includes(' "'), 'JSON compatto');
  });

  it('lo stesso evento mandato due volte entra una volta sola', async () => {
    const t = tiro('1d8', [[5]]);
    const prima = await tavolo.tira(t);
    const seconda = await tavolo.tira(t);
    assert.deepEqual(prima, { tipo: 'ricevuto', id: t.id, seq: 3, doppione: false });
    assert.deepEqual(seconda, { tipo: 'ricevuto', id: t.id, seq: 3, doppione: true });
    assert.equal(righeDelRegistro(dir.registro).length, 3);
    await evento(tavolo, (e) => e.type === 'roll.completed' && e.id === t.id);
    await assert.rejects(
      tavolo.aspetta((m) => m.tipo === 'evento' && m.evento.type === 'roll.completed' && m.evento.id === t.id, 300),
      'diffuso una volta sola',
    );
  });

  it('una richiesta con attesa: il tiro torna nella risposta', async () => {
    const r = await posta(P, '/api/richieste', { formula: '1d20 + 3', label: '  Salvezza su Costituzione ' });
    assert.equal(r.codice, 200);
    const creata = r.json().richiesta as RichiestaCreata;
    assert.equal(creata.requestId, 'r-0001');
    assert.equal(creata.formula, '1d20+3', 'formula in forma canonica');
    assert.equal(creata.label, 'Salvezza su Costituzione');
    const visto = await evento<RichiestaCreata>(tavolo, (e) => e.type === 'request.created');
    assert.deepEqual(visto, creata);

    const attesa = posta(P, '/api/richieste/r-0001/attendi', { secondi: 5 });
    await dormi(150);
    const t = tiro('1d20+3', [[20]], { requestId: 'r-0001', label: 'Salvezza su Costituzione' });
    assert.equal((await tavolo.tira(t)).tipo, 'ricevuto');
    const risposta = (await attesa).json() as unknown as RispostaAttesa;
    assert.equal(risposta.stato, 'tirato');
    if (risposta.stato === 'tirato') {
      assert.equal(risposta.tiro.id, t.id);
      assert.equal(risposta.tiro.nat20, true);
      assert.equal(risposta.tiro.total, 23);
    }
    // Chiesta di nuovo dopo il tiro, l'attesa risponde subito col tiro.
    const ancora = (await posta(P, '/api/richieste/r-0001/attendi', { secondi: 30 })).json() as unknown as RispostaAttesa;
    assert.equal(ancora.stato, 'tirato');
  });

  it('una richiesta scaduta risponde «in attesa» e resta aperta', async () => {
    const creata = (await posta(P, '/api/richieste', { formula: '1d20', label: 'Furtività' })).json().richiesta as RichiestaCreata;
    assert.equal(creata.requestId, 'r-0002');
    const inizio = Date.now();
    const r = (await posta(P, '/api/richieste/r-0002/attendi', { secondi: 1 })).json() as unknown as RispostaAttesa;
    const durata = Date.now() - inizio;
    assert.equal(r.stato, 'in attesa');
    assert.ok(durata >= 950 && durata < 5000, `attesa di ${durata} ms`);
    const stato = (await http(P, { percorso: '/api/stato' })).json();
    assert.deepEqual(
      (stato.richiesteAperte as RichiestaCreata[]).map((x) => x.requestId),
      ['r-0002'],
    );
    assert.equal(stato.tavoli, 1);
  });

  it('un tiro libero non soddisfa la richiesta aperta', async () => {
    const libero = tiro('1d20', [[9]]);
    assert.equal((await tavolo.tira(libero)).tipo, 'ricevuto');
    assert.equal(ponte.registro.richiesta('r-0002')!.stato, 'aperta');
  });

  it('una richiesta annullata: il tavolo lo sa e il suo tiro diventa un rifiuto', async () => {
    const r = await posta(P, '/api/richieste/r-0002/annulla', {});
    assert.equal(r.codice, 200);
    const annullata = await evento(tavolo, (e) => e.type === 'request.cancelled');
    assert.equal(annullata.type === 'request.cancelled' && annullata.requestId, 'r-0002');
    const tardi = tiro('1d20', [[4]], { requestId: 'r-0002', label: 'Furtività' });
    const esito = await tavolo.tira(tardi);
    assert.deepEqual(esito, { tipo: 'respinto', id: tardi.id, motivo: 'r-0002: request cancelled', richiesta: 'annullata' });
    const ancora = await posta(P, '/api/richieste/r-0002/annulla', {});
    assert.equal(ancora.codice, 409);
    assert.match(String(ancora.json().errore), /already cancelled/);
  });

  it('annullata durante l’attesa: chi aspetta lo sa subito', async () => {
    await posta(P, '/api/richieste', { formula: '1d4', label: 'Danni del pugnale' });
    const attesa = posta(P, '/api/richieste/r-0003/attendi', { secondi: 20 });
    await dormi(150);
    const inizio = Date.now();
    await posta(P, '/api/richieste/r-0003/annulla', {});
    const r = (await attesa).json() as unknown as RispostaAttesa;
    assert.equal(r.stato, 'annullata');
    // Subito: molto prima dei 20 secondi dell'attesa.
    assert.ok(Date.now() - inizio < 5000, `risposta dopo ${Date.now() - inizio} ms`);
  });

  it('annullare una richiesta già tirata riporta il tiro', async () => {
    const r = await posta(P, '/api/richieste/r-0001/annulla', {});
    assert.equal(r.codice, 409);
    const corpo = r.json();
    assert.match(String(corpo.errore), /r-0001: already rolled/);
    assert.equal((corpo.tiro as TiroCompletato).requestId, 'r-0001');
  });

  it('richieste sconosciute: rifiuto del tiro, 404 dell’attesa', async () => {
    const t = tiro('1d6', [[2]], { requestId: 'r-9999' });
    const esito = await tavolo.tira(t);
    assert.equal(esito.tipo, 'respinto');
    assert.equal((esito as { richiesta: string }).richiesta, 'sconosciuta');
    assert.equal((await posta(P, '/api/richieste/r-9999/attendi', { secondi: 1 })).codice, 404);
    assert.equal((await posta(P, '/api/richieste/r-0001/attendi', { secondi: -1 })).codice, 400);
  });

  it('gli eventi: gli ultimi 10, quelli dopo un seq, i limiti', async () => {
    const tutti = ponte.registro.ultimoSeq;
    const ultimi = (await http(P, { percorso: '/api/eventi' })).json();
    assert.equal(ultimi.ultimoSeq, tutti);
    assert.equal((ultimi.eventi as Evento[]).length, Math.min(10, tutti));
    assert.equal((ultimi.eventi as Evento[]).at(-1)!.seq, tutti);
    const dopo = (await http(P, { percorso: `/api/eventi?dopo=${tutti - 3}` })).json();
    assert.deepEqual(
      (dopo.eventi as Evento[]).map((e) => e.seq),
      [tutti - 2, tutti - 1, tutti],
    );
    const due = (await http(P, { percorso: '/api/eventi?dopo=0&limite=2' })).json();
    assert.deepEqual(
      (due.eventi as Evento[]).map((e) => e.seq),
      [1, 2],
    );
    assert.equal((await http(P, { percorso: '/api/eventi?dopo=uno' })).codice, 400);
    assert.equal((await http(P, { percorso: '/api/eventi?limite=0' })).codice, 400);
    assert.equal((await http(P, { percorso: '/api/eventi?limite=501' })).codice, 400);
  });

  it('il feed: recupero dopo un seq, poi dal vivo, coi tiri già consegnati segnati', async () => {
    const f = await apriFeed(P, 'dopo=3');
    const tutti = ponte.registro.ultimoSeq;
    await finché(() => f.righe.length === tutti - 3, 2000, 'recupero del feed');
    assert.deepEqual(
      f.righe.map((r) => r.evento.seq),
      Array.from({ length: tutti - 3 }, (_, i) => i + 4),
    );
    const delDm = f.righe.find((r) => r.evento.type === 'roll.completed' && r.evento.requestId === 'r-0001');
    assert.equal(delDm?.consegnato, true, 'il tiro uscito nella risposta all’attesa');
    const libero = f.righe.find((r) => r.evento.type === 'roll.completed' && r.evento.requestId === null);
    assert.equal(libero?.consegnato, false);
    const nuovo = tiro('1d12', [[11]]);
    await tavolo.tira(nuovo);
    await finché(() => f.righe.length === tutti - 2, 2000, 'evento dal vivo');
    assert.equal(f.righe.at(-1)!.evento.seq, tutti + 1);
    f.ws.close();
  });

  it('il feed con dal: soltanto gli eventi da quell’ora', async () => {
    const ora = new Date().toISOString();
    await dormi(5);
    const t = tiro('1d10', [[3]]);
    await tavolo.tira(t);
    const f = await apriFeed(P, `dal=${encodeURIComponent(ora)}`);
    await finché(() => f.righe.length >= 1, 2000, 'feed dal');
    await dormi(100);
    assert.deepEqual(
      f.righe.map((r) => (r.evento.type === 'roll.completed' ? r.evento.id : null)),
      [t.id],
    );
    f.ws.close();
  });

  it('un secondo tavolo riceve al collegamento cronaca e richieste aperte', async () => {
    await posta(P, '/api/richieste', { formula: '2d20kh1+4', label: 'Attacco con vantaggio' });
    const secondo = await TavoloDiProva.apri(P);
    assert.equal(secondo.stato.ultimoSeq, ponte.registro.ultimoSeq);
    assert.deepEqual(
      secondo.stato.richieste.map((r) => r.requestId),
      ['r-0004'],
    );
    assert.equal(secondo.stato.cronaca.length, ponte.registro.ultimiTiri(1000).length);
    assert.equal(secondo.stato.cronaca[0]!.id, primo.id, 'la cronaca va dal più vecchio');
    // Un tiro dal primo tavolo arriva anche al secondo.
    const t = tiro('1d4', [[1]]);
    await tavolo.tira(t);
    await secondo.aspetta((m) => m.tipo === 'evento' && m.evento.type === 'roll.completed' && m.evento.id === t.id);
    await secondo.chiudi();
  });
});

describe('il ponte riavviato a metà', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;

  before(async () => {
    ponte = await accendiPonte(dir.registro, dir.client);
    P = ponte.porta;
  });
  after(async () => {
    await ponte.ferma();
    dir.via();
  });

  it('tornano cronologia, seq e richieste aperte; un’attesa in corso risponde «in attesa»', async () => {
    const t1 = await TavoloDiProva.apri(P);
    const a = tiro('1d20', [[15]]);
    await t1.tira(a);
    await posta(P, '/api/richieste', { formula: '1d20+2', label: 'Intuizione' });
    await posta(P, '/api/richieste', { formula: '8d6', label: 'Palla di fuoco: danni' });
    await posta(P, '/api/richieste/r-0002/annulla', {});
    const b = tiro('1d20+2', [[7]], { requestId: 'r-0001', label: 'Intuizione' });
    await t1.tira(b);
    await posta(P, '/api/richieste', { formula: '1d20-1', label: 'Atletica' });
    const prima = ponte.registro.ultimoSeq;
    assert.equal(prima, 6);

    const attesa = posta(P, '/api/richieste/r-0003/attendi', { secondi: 30 });
    await dormi(150);
    const chiuso = new Promise<void>((ok) => t1.ws.once('close', () => ok()));
    await ponte.ferma();
    await chiuso;
    const r = (await attesa).json() as unknown as RispostaAttesa;
    assert.equal(r.stato, 'in attesa');

    // Una scrittura interrotta a metà durante lo spegnimento.
    appendFileSync(dir.registro, '{"v":1,"seq":7,"type":"roll.comp');

    ponte = await accendiPonte(dir.registro, dir.client, P);
    assert.equal(ponte.porta, P);
    assert.equal(ponte.registro.ultimoSeq, prima);
    assert.equal(ponte.registro.scartate.length, 1);
    assert.deepEqual(
      ponte.registro.richiesteAperte().map((x) => x.requestId),
      ['r-0003'],
    );
    assert.equal(ponte.registro.richiesta('r-0001')!.stato, 'soddisfatta');
    assert.equal(ponte.registro.richiesta('r-0002')!.stato, 'annullata');

    const t2 = await TavoloDiProva.apri(P);
    assert.equal(t2.stato.ultimoSeq, prima);
    assert.deepEqual(
      t2.stato.cronaca.map((x) => x.id),
      [a.id, b.id],
    );
    assert.deepEqual(
      t2.stato.richieste.map((x) => x.requestId),
      ['r-0003'],
    );
    // Lo stesso tiro rimandato dopo il riavvio è un doppione; la richiesta aperta si tira ancora.
    assert.deepEqual(await t2.tira(a), { tipo: 'ricevuto', id: a.id, seq: 1, doppione: true });
    const c = tiro('1d20-1', [[1]], { requestId: 'r-0003', label: 'Atletica' });
    assert.deepEqual(await t2.tira(c), { tipo: 'ricevuto', id: c.id, seq: 7, doppione: false });
    const nuova = (await posta(P, '/api/richieste', { formula: '1d6', label: 'Dado vita' })).json().richiesta as RichiestaCreata;
    assert.equal(nuova.requestId, 'r-0004', 'la numerazione delle richieste continua');
    assert.equal(nuova.seq, 8);

    // Il registro resta un JSONL leggibile: la riga troncata sta da sola e le altre si leggono tutte.
    const righe = righeDelRegistro(dir.registro);
    const leggibili = righe.filter((x) => {
      try {
        JSON.parse(x);
        return true;
      } catch {
        return false;
      }
    });
    assert.equal(righe.length, 9);
    assert.deepEqual(
      leggibili.map((x) => (JSON.parse(x) as Evento).seq),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );

    // La ripresa dopo un seq: il feed riparte da dove si era rimasti.
    const f = await apriFeed(P, 'dopo=6');
    await finché(() => f.righe.length === 2, 2000, 'ripresa del feed');
    assert.deepEqual(
      f.righe.map((x) => x.evento.seq),
      [7, 8],
    );
    f.ws.close();
    await t2.chiudi();
  });
});
