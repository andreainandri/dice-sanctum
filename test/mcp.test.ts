// Le prove d'integrazione del server MCP vero, lanciato come lo lancia Claude Code, col client
// dell'SDK al posto della sessione del DM: i sei strumenti, il canale (ogni tiro una volta sola),
// le attese, gli annullamenti, i dadi del master, i tiri fatti al posto di chi gioca, il ponte spento
// e riavviato a metà.

import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { type Ponte } from '../src/bridge/ponte.ts';
import { type Evento, type RichiestaCreata } from '../src/shared/eventi.ts';
import { type DalPonte } from '../src/shared/protocollo.ts';
import { TavoloDiProva, accendiPonte, cartellaDiProva, clientMcp, dormi, tiro } from './aiuti.ts';

type Mcp = Awaited<ReturnType<typeof clientMcp>>;

function portaLibera(): Promise<number> {
  return new Promise((ok, ko) => {
    const s = createServer();
    s.once('error', ko);
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      const p = typeof a === 'object' && a ? a.port : 0;
      s.close(() => ok(p));
    });
  });
}

const seqDi = (m: DalPonte): number => {
  assert.equal(m.tipo, 'ricevuto', JSON.stringify(m));
  return (m as { seq: number }).seq;
};

/** La richiesta che il tavolo vede arrivare. */
const richiestaSulTavolo = (t: TavoloDiProva, label: string) =>
  t
    .aspetta((m) => m.tipo === 'evento' && m.evento.type === 'request.created' && m.evento.label === label)
    .then((m) => (m as { evento: RichiestaCreata }).evento);

describe('il server MCP col ponte spento', () => {
  let mcp: Mcp;
  before(async () => {
    mcp = await clientMcp(await portaLibera());
  });
  after(async () => {
    await mcp.chiudi();
  });

  it('elenca i sei strumenti, con l’attesa fino a 110 secondi e fino a otto tiri per lancio', async () => {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['cancel_player_roll', 'dm_roll', 'get_rolls', 'get_status', 'request_player_roll', 'roll_for_player']);
    for (const nome of ['dm_roll', 'roll_for_player']) {
      const lancio = tools.find((t) => t.name === nome)!;
      assert.deepEqual(lancio.inputSchema.required, ['rolls'], nome);
      const tiri = (lancio.inputSchema.properties as Record<string, { minItems?: number; maxItems?: number; items?: { required?: string[] } }>).rolls!;
      assert.equal(tiri.minItems, 1, nome);
      assert.equal(tiri.maxItems, 8, nome);
      assert.deepEqual(tiri.items?.required, ['formula', 'label'], nome);
    }
    // Chi tira al posto di chi gioca non può tirare di nascosto.
    assert.deepEqual(Object.keys(tools.find((t) => t.name === 'roll_for_player')!.inputSchema.properties ?? {}), ['rolls']);
    const richiesta = tools.find((t) => t.name === 'request_player_roll')!;
    const proprieta = richiesta.inputSchema.properties as Record<string, { maximum?: number }>;
    assert.equal(proprieta.wait_seconds?.maximum, 110);
    assert.deepEqual(richiesta.inputSchema.required, ['formula', 'label']);
  });

  it('dichiara il canale e dà le istruzioni alla sessione', () => {
    assert.deepEqual(mcp.client.getServerCapabilities()?.experimental, { 'claude/channel': {} });
    assert.match(mcp.client.getInstructions() ?? '', /<channel source="dice-sanctum"/);
    // Senza DICE_SANCTUM_PLAYER il giocatore non ha nome.
    assert.match(mcp.client.getInstructions() ?? '', /^Dice Sanctum: the 3D dice table where the player rolls the dice of their character\./);
    assert.match(mcp.client.getInstructions() ?? '', /For the DM's own dice \(monsters, companions, hidden checks\) use dm_roll\./);
    assert.match(mcp.client.getInstructions() ?? '', /When the player cannot be at the table and asks you to roll for them, use roll_for_player:/);
    assert.match(mcp.client.getInstructions() ?? '', /Use it only on their word .*never on your own initiative/);
  });

  it('dice chiaro che il ponte è spento', async () => {
    const s = await mcp.chiama('get_status');
    assert.equal(s.errore, false);
    assert.match(s.testo, /^Bridge: off\. The bridge does not answer at http:\/\/127\.0\.0\.1:\d+: the Dice Sanctum is off\./);
    const r = await mcp.chiama('request_player_roll', { formula: '1d20+3', label: 'Salvezza su Costituzione', wait_seconds: 5 });
    assert.equal(r.errore, true);
    assert.match(r.testo, /the Dice Sanctum is off\. It starts with `npm start` in the dice-sanctum folder, or with the table skill of the Dice Sanctum plugin\./);
    assert.equal((await mcp.chiama('get_rolls')).errore, true);
    assert.equal((await mcp.chiama('cancel_player_roll', { requestId: 'r-0001' })).errore, true);
    const m = await mcp.chiama('dm_roll', { rolls: [{ formula: '1d20+4', label: 'Lupo, morso' }] });
    assert.equal(m.errore, true);
    assert.match(m.testo, /the Dice Sanctum is off\./);
    const perLui = await mcp.chiama('roll_for_player', { rolls: [{ formula: '1d20+5', label: 'Percezione' }] });
    assert.equal(perLui.errore, true);
    assert.match(perLui.testo, /the Dice Sanctum is off\./);
  });

  it('respinge un’attesa oltre il massimo e una formula sbagliata', async () => {
    const lunga = await mcp.chiama('request_player_roll', { formula: '1d20', label: 'Prova', wait_seconds: 180 }).catch((e: Error) => ({
      testo: e.message,
      errore: true,
    }));
    assert.equal(lunga.errore, true);
    assert.match(lunga.testo, /wait_seconds/);
    const storta = await mcp.chiama('request_player_roll', { formula: '1d7', label: 'Prova' });
    assert.equal(storta.errore, true);
    assert.match(storta.testo, /^invalid formula/);
    const delMaster = await mcp.chiama('dm_roll', { rolls: [{ formula: '1d20', label: 'Buona' }, { formula: '2d7', label: 'Storta' }] });
    assert.equal(delMaster.errore, true);
    assert.match(delMaster.testo, /^roll 2: invalid formula/);
    for (const rolls of [[], Array.from({ length: 9 }, () => ({ formula: '1d6', label: 'x' })), [{ formula: '1d6' }]]) {
      const r = await mcp.chiama('dm_roll', { rolls }).catch((e: Error) => ({ testo: e.message, errore: true }));
      assert.equal(r.errore, true, JSON.stringify(rolls));
      assert.match(r.testo, /rolls/);
    }
    const perLui = await mcp.chiama('roll_for_player', { rolls: [{ formula: '1d20', label: 'Buona' }, { formula: '2d7', label: 'Storta' }] });
    assert.equal(perLui.errore, true);
    assert.match(perLui.testo, /^roll 2: invalid formula/);
  });

  it('esce da solo quando la sessione chiude stdin, anche col feed che si ricollega', async () => {
    const altro = await clientMcp(await portaLibera());
    await dormi(1500);
    const inizio = Date.now();
    await altro.chiudi();
    // Il client dell'SDK aspetta l'uscita fino a 2 secondi, poi manda SIGTERM: sotto i 1800 ms il server
    // è uscito da solo, con margine per una macchina carica.
    assert.ok(Date.now() - inizio < 1800, `chiuso in ${Date.now() - inizio} ms`);
  });
});

describe('il server MCP col ponte acceso', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let mcp: Mcp;
  let tavolo: TavoloDiProva;
  /** I tiri che il DM ha ricevuto nella risposta di una chiamata. */
  const dallaChiamata: number[] = [];

  /** Quante volte un seq è uscito dal canale. */
  const volte = (seq: number) => mcp.canale.filter((n) => n.meta.seq === String(seq)).length;

  before(async () => {
    ponte = await accendiPonte(dir.registro, dir.client);
    P = ponte.porta;
    // Un tiro di prima che la sessione del DM partisse: è storia, il canale non lo ripete.
    const t = await TavoloDiProva.apri(P);
    await t.tira(tiro('1d20', [[2]]));
    await t.chiudi();
    await dormi(20);
    mcp = await clientMcp(P, 'Ada');
  });
  after(async () => {
    await tavolo?.chiudi();
    await mcp.chiudi();
    await ponte.ferma();
    dir.via();
  });

  it('senza tavolo: lo stato lo dice e la richiesta è un errore', async () => {
    const s = await mcp.chiama('get_status');
    assert.equal(s.testo, `Bridge: on at http://127.0.0.1:${P}.\nTables connected: none (no browser has the Dice Sanctum open).\nLast seq: 1.\nOpen requests: none.`);
    const r = await mcp.chiama('request_player_roll', { formula: '1d20+3', label: 'Salvezza su Costituzione', wait_seconds: 5 });
    assert.equal(r.errore, true);
    assert.match(r.testo, /no table connected/);
    assert.equal(ponte.registro.ultimoSeq, 1, 'nessuna richiesta scritta');
  });

  it('un tiro libero arriva dal canale, una volta, e quello di prima no', async () => {
    tavolo = await TavoloDiProva.apri(P);
    const seq = seqDi(await tavolo.tira(tiro('1d20+5', [[20]], { label: 'Percezione' })));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    assert.equal(n.content, 'Free roll by Ada: Percezione 1d20+5: [20] +5 = 25 · NATURAL 20');
    assert.deepEqual(n.meta, { seq: String(seq), kind: 'free', total: '25' });
    assert.equal(volte(1), 0);
  });

  it('due tiri di fila: due notifiche, in ordine', async () => {
    const a = tiro('1d6', [[3]]);
    const b = tiro('1d8', [[8]]);
    tavolo.manda(a);
    tavolo.manda(b);
    const sa = seqDi(await tavolo.aspetta((m) => m.tipo === 'ricevuto' && m.id === a.id));
    const sb = seqDi(await tavolo.aspetta((m) => m.tipo === 'ricevuto' && m.id === b.id));
    assert.equal(sb, sa + 1);
    await mcp.aspettaCanale((x) => x.meta.seq === String(sb));
    assert.deepEqual(
      mcp.canale.slice(-2).map((x) => Number(x.meta.seq)),
      [sa, sb],
    );
  });

  it('lo stesso evento mandato due volte: una notifica sola', async () => {
    const t = tiro('1d12', [[7]]);
    const seq = seqDi(await tavolo.tira(t));
    const di_nuovo = await tavolo.tira(t);
    assert.deepEqual(di_nuovo, { tipo: 'ricevuto', id: t.id, seq, doppione: true });
    await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    await dormi(300);
    assert.equal(volte(seq), 1);
  });

  it('una richiesta con attesa: il tiro torna nella chiamata e non dal canale', async () => {
    const chiamata = mcp.chiama('request_player_roll', { formula: '1d20 + 3', label: 'Salvezza su Costituzione', wait_seconds: 20 });
    const r = await richiestaSulTavolo(tavolo, 'Salvezza su Costituzione');
    assert.equal(r.requestId, 'r-0001');
    assert.equal(r.formula, '1d20+3');
    await dormi(200);
    const seq = seqDi(await tavolo.tira(tiro('1d20+3', [[11]], { requestId: 'r-0001', label: r.label })));
    const risposta = await chiamata;
    assert.equal(risposta.errore, false);
    assert.equal(risposta.testo, `Ada rolled r-0001: Salvezza su Costituzione 1d20+3: [11] +3 = 14 (seq ${seq}).`);
    dallaChiamata.push(seq);
    await dormi(400);
    assert.equal(volte(seq), 0);
  });

  it('una richiesta scaduta: «in attesa», poi il tiro arriva dal canale', async () => {
    const inizio = Date.now();
    const risposta = await mcp.chiama('request_player_roll', { formula: '1d20', label: 'Furtività', wait_seconds: 1 });
    assert.ok(Date.now() - inizio >= 950);
    assert.equal(risposta.testo, 'Waiting: Ada has not rolled r-0002 (Furtività, 1d20) yet. The roll will arrive through the channel as soon as it lands.');
    const seq = seqDi(await tavolo.tira(tiro('1d20', [[1]], { requestId: 'r-0002', label: 'Furtività' })));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    assert.equal(n.content, 'Requested roll (r-0002), arrived after the wait: Furtività 1d20: [1] = 1 · NATURAL 1');
    assert.deepEqual(n.meta, { seq: String(seq), kind: 'requested', total: '1', request_id: 'r-0002' });
  });

  it('senza attesa: risposta subito, il tiro dal canale', async () => {
    const r = await mcp.chiama('request_player_roll', { formula: '4d6kh3', label: 'Caratteristica' });
    assert.equal(r.testo, 'Request r-0003 (Caratteristica, 4d6kh3) is on the table of Ada. The roll will arrive through the channel.');
    const seq = seqDi(await tavolo.tira(tiro('4d6kh3', [[6, 2, 5, 5]], { requestId: 'r-0003', label: 'Caratteristica' })));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    assert.equal(n.content, 'Requested roll (r-0003), arrived after the wait: Caratteristica 4d6kh3: [6 (2) 5 5] = 16');
  });

  it('un tiro libero non soddisfa la richiesta; annullata, sparisce dal tavolo', async () => {
    await mcp.chiama('request_player_roll', { formula: '1d20+1', label: 'Intuizione' });
    const libero = seqDi(await tavolo.tira(tiro('1d20+1', [[10]])));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(libero));
    assert.equal(n.meta.kind, 'free');
    const aperta = await mcp.chiama('get_status');
    assert.match(aperta.testo, /^Open requests \(oldest first\): r-0004 Intuizione, 1d20\+1, asked at \d\d:\d\d:\d\d\.$/m);
    const a = await mcp.chiama('cancel_player_roll', { requestId: 'r-0004' });
    assert.equal(a.testo, 'Request r-0004 cancelled: it is no longer on the table.');
    await tavolo.aspetta((m) => m.tipo === 'evento' && m.evento.type === 'request.cancelled' && m.evento.requestId === 'r-0004');
    const tardi = await tavolo.tira(tiro('1d20+1', [[5]], { requestId: 'r-0004', label: 'Intuizione' }));
    assert.equal(tardi.tipo, 'respinto');
    assert.match((await mcp.chiama('get_status')).testo, /^Open requests: none\.$/m);
  });

  it('annullata durante l’attesa: la chiamata lo dice subito', async () => {
    const chiamata = mcp.chiama('request_player_roll', { formula: '1d4', label: 'Danni del pugnale', wait_seconds: 20 });
    const r = await richiestaSulTavolo(tavolo, 'Danni del pugnale');
    const a = await mcp.chiama('cancel_player_roll', { requestId: r.requestId });
    assert.equal(a.errore, false);
    assert.equal((await chiamata).testo, `Request ${r.requestId} (Danni del pugnale, 1d4) was cancelled before the roll.`);
  });

  it('annullare una richiesta già tirata riporta il tiro; una sconosciuta è un errore', async () => {
    const a = await mcp.chiama('cancel_player_roll', { requestId: 'r-0001' });
    assert.equal(a.errore, true);
    assert.match(a.testo, /^r-0001: already rolled: Salvezza su Costituzione 1d20\+3: \[11\] \+3 = 14 \(seq \d+\)\.$/);
    const b = await mcp.chiama('cancel_player_roll', { requestId: 'r-0099' });
    assert.equal(b.errore, true);
    assert.equal(b.testo, 'r-0099: unknown request');
  });

  it('attesa interrotta dal DM: il tiro arriva poi dal canale', async () => {
    const ac = new AbortController();
    const chiamata = mcp.client.callTool(
      { name: 'request_player_roll', arguments: { formula: '1d20+7', label: 'Attacco', wait_seconds: 30 } },
      undefined,
      { signal: ac.signal },
    );
    const r = await richiestaSulTavolo(tavolo, 'Attacco');
    await dormi(200);
    ac.abort();
    await assert.rejects(chiamata);
    await dormi(300);
    const seq = seqDi(await tavolo.tira(tiro('1d20+7', [[13]], { requestId: r.requestId, label: 'Attacco' })));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    assert.equal(n.content, `Requested roll (${r.requestId}), arrived after the wait: Attacco 1d20+7: [13] +7 = 20`);
  });

  it('get_rolls: gli ultimi 10 e la ripresa con since_seq', async () => {
    const ultimo = ponte.registro.ultimoSeq;
    assert.ok(ultimo > 12);
    const g = (await mcp.chiama('get_rolls')).testo.split('\n');
    assert.equal(g.length, 11);
    assert.equal(g.at(-1), `Last seq of the roll log: ${ultimo}.`);
    assert.deepEqual(
      g.slice(0, 10).map((x) => Number(/^#(\d+) /.exec(x)?.[1])),
      Array.from({ length: 10 }, (_, i) => ultimo - 9 + i),
    );
    const dopo = (await mcp.chiama('get_rolls', { since_seq: ultimo - 2 })).testo.split('\n');
    assert.deepEqual(
      dopo.slice(0, -1).map((x) => Number(/^#(\d+) /.exec(x)?.[1])),
      [ultimo - 1, ultimo],
    );
    assert.equal((await mcp.chiama('get_rolls', { since_seq: ultimo })).testo, `No events.\nLast seq of the roll log: ${ultimo}.`);
    const tutto = (await mcp.chiama('get_rolls', { since_seq: 0, limit: 500 })).testo;
    assert.match(tutto, /^#2 \d\d:\d\d:\d\d free roll · Percezione 1d20\+5: \[20\] \+5 = 25 · NATURAL 20$/m);
    assert.match(tutto, /^#\d+ \d\d:\d\d:\d\d request r-0001 · Salvezza su Costituzione, 1d20\+3$/m);
    assert.match(tutto, /^#\d+ \d\d:\d\d:\d\d for r-0001 · Salvezza su Costituzione 1d20\+3: \[11\] \+3 = 14$/m);
    assert.match(tutto, /^#\d+ \d\d:\d\d:\d\d cancelled r-0004$/m);
  });

  it('ponte riavviato a metà: l’attesa risponde «in attesa», poi tutto riprende senza doppioni', async () => {
    const chiamata = mcp.chiama('request_player_roll', { formula: '1d20+2', label: 'Religione', wait_seconds: 30 });
    const r = await richiestaSulTavolo(tavolo, 'Religione');
    await dormi(200);
    const ultimo = ponte.registro.ultimoSeq;
    await ponte.ferma();
    assert.equal(
      (await chiamata).testo,
      `Waiting: Ada has not rolled ${r.requestId} (Religione, 1d20+2) yet. The roll will arrive through the channel as soon as it lands.`,
    );
    assert.match((await mcp.chiama('get_status')).testo, /^Bridge: off\./);
    const prima = mcp.canale.length;

    ponte = await accendiPonte(dir.registro, dir.client, P);
    tavolo = await TavoloDiProva.apri(P);
    assert.deepEqual(
      tavolo.stato.richieste.map((x) => x.requestId),
      [r.requestId],
    );
    assert.match((await mcp.chiama('get_status')).testo, new RegExp(`Last seq: ${ultimo}\\.`));
    const s1 = seqDi(await tavolo.tira(tiro('1d20+2', [[16]], { requestId: r.requestId, label: 'Religione' })));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(s1), 15000);
    assert.equal(n.meta.request_id, r.requestId);
    const s2 = seqDi(await tavolo.tira(tiro('1d6', [[6]])));
    await mcp.aspettaCanale((x) => x.meta.seq === String(s2), 5000);
    await dormi(300);
    assert.equal(mcp.canale.length, prima + 2);
  });

  it('alla fine ogni tiro è arrivato al DM una volta sola, dal canale o dalla chiamata', async () => {
    const dalCanale = mcp.canale.map((x) => Number(x.meta.seq));
    assert.equal(new Set(dalCanale).size, dalCanale.length, 'nessun doppione nel canale');
    for (const s of dallaChiamata) assert.ok(!dalCanale.includes(s), `seq ${s} arrivato due volte`);
    const tiri = ponte.registro
      .eventiDopo(0, 10000)
      .filter((e): e is Extract<Evento, { type: 'roll.completed' }> => e.type === 'roll.completed')
      .map((e) => e.seq)
      .filter((s) => s !== 1);
    assert.deepEqual([...dalCanale, ...dallaChiamata].sort((a, b) => a - b), tiri);
  });
});

describe('il master tira dal server MCP', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let mcp: Mcp;
  let tavolo: TavoloDiProva;

  const lancio = (t: TavoloDiProva) => t.aspetta<Extract<DalPonte, { tipo: 'lancio del master' }>>((m) => m.tipo === 'lancio del master');

  before(async () => {
    // Le attese delle riprese durano un ventesimo del vero.
    ponte = await accendiPonte(dir.registro, dir.client, 0, { ritmoDelleRiprese: 0.05 });
    P = ponte.porta;
    mcp = await clientMcp(P, 'Ada');
  });
  after(async () => {
    await tavolo?.chiudi();
    await mcp.chiudi();
    await ponte.ferma();
    dir.via();
  });

  it('senza tavolo tira lo stesso e dice che nessuno l’ha visto', async () => {
    const r = await mcp.chiama('dm_roll', { rolls: [{ formula: '1d20+4', label: 'Lupo, morso' }] });
    assert.equal(r.errore, false);
    assert.match(r.testo, /^DM throw \(no table connected: nobody saw it land\):\n#1 Lupo, morso 1d20\+4: \[\d+\] \+4 = \d+( · NATURAL (20|1))?$/);
    assert.equal(ponte.registro.ultimoSeq, 1);
  });

  it('in chiaro: i tiri di un turno in un lancio solo, sul tavolo, ognuno con la sua riga', async () => {
    tavolo = await TavoloDiProva.apri(P);
    const chiamata = mcp.chiama('dm_roll', {
      rolls: [
        { formula: '1d20 + 4', label: 'Lupo, morso' },
        { formula: '2d4+2', label: 'Lupo, danno' },
      ],
    });
    const m = await lancio(tavolo);
    const r = await chiamata;
    assert.equal(r.errore, false);
    const righe = r.testo.split('\n');
    assert.equal(righe[0], 'DM throw (on the table of Ada):');
    assert.deepEqual(righe.slice(1), m.tiri.map((t) => `#${t.seq} ${t.summary}${t.nat20 ? ' · NATURAL 20' : t.nat1 ? ' · NATURAL 1' : ''}`));
    assert.deepEqual(m.tiri.map((t) => [t.seq, t.label, t.formula]), [
      [2, 'Lupo, morso', '1d20+4'],
      [3, 'Lupo, danno', '2d4+2'],
    ]);
    assert.equal(m.ripresa.dadi.length, 3);
  });

  it('dietro lo schermo: la risposta ha i numeri, il tavolo una voce coperta', async () => {
    const r = await mcp.chiama('dm_roll', { rolls: [{ formula: '1d20+6', label: 'Furtività della creatura' }], secret: true });
    assert.match(r.testo, /^DM throw \(behind the screen\):\n#4 Furtività della creatura 1d20\+6: \[\d+\] \+6 = \d+/);
    const m = await tavolo.aspetta<Extract<DalPonte, { tipo: 'evento' }>>((x) => x.tipo === 'evento' && x.evento.type === 'dm.roll.hidden');
    assert.deepEqual(Object.keys(m.evento), ['v', 'seq', 'type', 'id', 'at', 'throwId']);
    assert.equal(m.evento.seq, 4);
  });

  it('un tiro del master non chiude una richiesta e non torna dal canale; il tiro del tavolo sì', async () => {
    const chiesta = await mcp.chiama('request_player_roll', { formula: '1d20+3', label: 'Salvezza su Costituzione' });
    assert.match(chiesta.testo, /^Request r-0001 /);
    await richiestaSulTavolo(tavolo, 'Salvezza su Costituzione');
    await mcp.chiama('dm_roll', { rolls: [{ formula: '1d20+3', label: 'Salvezza su Costituzione' }] });
    await lancio(tavolo);
    assert.match((await mcp.chiama('get_status')).testo, /^Open requests \(oldest first\): r-0001 Salvezza su Costituzione, 1d20\+3, asked at \d\d:\d\d:\d\d\.$/m);
    const seq = seqDi(await tavolo.tira(tiro('1d20+3', [[12]], { requestId: 'r-0001', label: 'Salvezza su Costituzione' })));
    const n = await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    assert.equal(n.meta.request_id, 'r-0001');
    await dormi(300);
    // Dal canale è uscito soltanto il tiro del tavolo: i tiri del master tornano nella loro chiamata.
    assert.deepEqual(mcp.canale.map((x) => Number(x.meta.seq)), [seq]);
  });

  it('get_rolls li mostra, e dice dove sono caduti', async () => {
    const tutto = (await mcp.chiama('get_rolls', { since_seq: 0, limit: 100 })).testo;
    assert.match(tutto, /^#1 \d\d:\d\d:\d\d DM roll, no table connected · Lupo, morso 1d20\+4: /m);
    assert.match(tutto, /^#2 \d\d:\d\d:\d\d DM roll, on the table · Lupo, morso 1d20\+4: /m);
    assert.match(tutto, /^#3 \d\d:\d\d:\d\d DM roll, on the table · Lupo, danno 2d4\+2: /m);
    assert.match(tutto, /^#4 \d\d:\d\d:\d\d DM roll, behind the screen · Furtività della creatura 1d20\+6: /m);
    assert.match(tutto, /^#5 \d\d:\d\d:\d\d request r-0001 · Salvezza su Costituzione, 1d20\+3$/m);
  });
});

describe('il master tira al posto di chi gioca dal server MCP', () => {
  const dir = cartellaDiProva();
  let ponte: Ponte;
  let P: number;
  let mcp: Mcp;
  let tavolo: TavoloDiProva;

  const lancio = (t: TavoloDiProva) => t.aspetta<Extract<DalPonte, { tipo: 'lancio per chi gioca' }>>((m) => m.tipo === 'lancio per chi gioca');
  const coda = '( · NATURAL (20|1))?';

  before(async () => {
    // Le attese delle riprese durano un ventesimo del vero.
    ponte = await accendiPonte(dir.registro, dir.client, 0, { ritmoDelleRiprese: 0.05 });
    P = ponte.porta;
    mcp = await clientMcp(P, 'Ada');
  });
  after(async () => {
    await tavolo?.chiudi();
    await mcp.chiudi();
    await ponte.ferma();
    dir.via();
  });

  it('senza tavolo tira lo stesso: il tiro è nel registro e la risposta dice che nessuno l’ha visto', async () => {
    const r = await mcp.chiama('roll_for_player', { rolls: [{ formula: '1d20+5', label: 'Percezione' }] });
    assert.equal(r.errore, false);
    assert.match(
      r.testo,
      new RegExp(`^Rolled in place of Ada \\(no table connected: it is in the roll log, nobody saw it land\\):\\n#1 Percezione 1d20\\+5: \\[\\d+\\] \\+5 = \\d+${coda}$`),
    );
    assert.equal(ponte.registro.ultimoSeq, 1);
  });

  it('col tavolo: i tiri di un’azione in un lancio solo, coi dadi di chi gioca, ognuno con la sua riga', async () => {
    tavolo = await TavoloDiProva.apri(P);
    const chiamata = mcp.chiama('roll_for_player', {
      rolls: [
        { formula: '1d20 + 6', label: 'Spada lunga, attacco' },
        { formula: '1d8+4', label: 'Spada lunga, danno' },
      ],
    });
    const m = await lancio(tavolo);
    const r = await chiamata;
    assert.equal(r.errore, false);
    const righe = r.testo.split('\n');
    assert.equal(righe[0], 'Rolled in place of Ada (shown on their table):');
    assert.deepEqual(righe.slice(1), m.tiri.map((t) => `#${t.seq} ${t.summary}${t.nat20 ? ' · NATURAL 20' : t.nat1 ? ' · NATURAL 1' : ''}`));
    assert.deepEqual(m.tiri.map((t) => [t.seq, t.type, t.rolledBy, t.label, t.formula]), [
      [2, 'roll.completed', 'dm', 'Spada lunga, attacco', '1d20+6'],
      [3, 'roll.completed', 'dm', 'Spada lunga, danno', '1d8+4'],
    ]);
    assert.equal(m.ripresa.dadi.length, 2);
  });

  it('con una richiesta aperta: non la chiude, e la risposta ricorda di annullarla', async () => {
    const chiesta = await mcp.chiama('request_player_roll', { formula: '1d20+3', label: 'Salvezza su Costituzione' });
    assert.match(chiesta.testo, /^Request r-0001 /);
    await richiestaSulTavolo(tavolo, 'Salvezza su Costituzione');
    const r = await mcp.chiama('roll_for_player', { rolls: [{ formula: '1d20+3', label: 'Salvezza su Costituzione' }] });
    await lancio(tavolo);
    assert.match(r.testo, /\nStill open on the table, not fulfilled by this throw: r-0001 \(Salvezza su Costituzione, 1d20\+3\)\. Cancel what this throw replaced\.$/);
    assert.match((await mcp.chiama('get_status')).testo, /^Open requests \(oldest first\): r-0001 /m);
    assert.match((await mcp.chiama('cancel_player_roll', { requestId: 'r-0001' })).testo, /^Request r-0001 cancelled/);
  });

  it('dal canale esce soltanto il tiro che chi gioca fa al tavolo: quelli fatti al suo posto tornano nella chiamata', async () => {
    const seq = seqDi(await tavolo.tira(tiro('1d20', [[14]], { label: 'Tornato al tavolo' })));
    await mcp.aspettaCanale((x) => x.meta.seq === String(seq));
    await dormi(300);
    assert.deepEqual(mcp.canale.map((x) => Number(x.meta.seq)), [seq]);
  });

  it('get_rolls li mostra come tiri di chi gioca fatti dal DM', async () => {
    const tutto = (await mcp.chiama('get_rolls', { since_seq: 0, limit: 100 })).testo;
    assert.match(tutto, /^#1 \d\d:\d\d:\d\d rolled by the DM for Ada · Percezione 1d20\+5: /m);
    assert.match(tutto, /^#2 \d\d:\d\d:\d\d rolled by the DM for Ada · Spada lunga, attacco 1d20\+6: /m);
    assert.match(tutto, /^#3 \d\d:\d\d:\d\d rolled by the DM for Ada · Spada lunga, danno 1d8\+4: /m);
    assert.match(tutto, /^#\d+ \d\d:\d\d:\d\d free roll · Tornato al tavolo 1d20: /m);
  });

  it('una sessione del DM aperta dopo non se li vede arrivare dal canale', async () => {
    const altra = await clientMcp(P, 'Ada');
    await mcp.chiama('roll_for_player', { rolls: [{ formula: '1d6', label: 'Danno' }] });
    await lancio(tavolo);
    const seq = seqDi(await tavolo.tira(tiro('1d20', [[3]], { label: 'Sentinella' })));
    await altra.aspettaCanale((x) => x.meta.seq === String(seq));
    await dormi(200);
    assert.deepEqual(altra.canale.map((x) => Number(x.meta.seq)), [seq]);
    await altra.chiudi();
  });
});
