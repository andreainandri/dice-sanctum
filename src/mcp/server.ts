// Il server MCP del Dice Sanctum, su stdio. Sette strumenti per il DM e, nelle sessioni che aprono il
// canale, ogni tiro che il DM non ha già ricevuto da una chiamata spinto nella conversazione appena i
// dadi si fermano. Sottile: stato e registro stanno nel ponte, che si raggiunge via HTTP e WebSocket.
// I testi sono in inglese: li legge il modello che fa il DM, qualunque lingua parli al tavolo.
//   DICE_SANCTUM_URL      l'indirizzo del ponte (http://127.0.0.1:4777)
//   DICE_SANCTUM_PLAYER   il nome di chi tira al tavolo, nei testi per il DM («the player» se manca)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { z } from 'zod';
import { type Evento, type TiroCompletato, type TiroDelMaster } from '../shared/eventi.ts';
import { ErroreFormula, MASSIMO_DADI_FISICI, leggiFormula } from '../shared/notazione.ts';
import {
  ATTESA_MASSIMA,
  type DalFeed,
  FORMULE_PER_LANCIO,
  PORTA_DEL_PONTE,
  type RispostaAnnulla,
  type RispostaAttesa,
  type RispostaDadiDelMaster,
  type RispostaErrore,
  type RispostaEventi,
  type RispostaRichiesta,
  type RispostaStato,
  type RispostaTiriDelMaster,
  type RispostaTiriPerChiGioca,
} from '../shared/protocollo.ts';
import { ASPETTO_DELLA_SERIE, SERIE, SERIE_DEL_MASTER_DI_PARTENZA, eSerie } from '../shared/serie.ts';

const PONTE = (process.env.DICE_SANCTUM_URL ?? `http://127.0.0.1:${PORTA_DEL_PONTE}`).replace(/\/+$/, '');
const AVVIO = new Date().toISOString();
// Una riga sola e corta: il nome entra nei testi e nelle istruzioni della sessione.
const GIOCATORE = (process.env.DICE_SANCTUM_PLAYER ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'the player';
/** Il giocatore in testa di frase. */
const GIOCATORE_IN_TESTA = GIOCATORE.charAt(0).toUpperCase() + GIOCATORE.slice(1);
const SPENTO = `The bridge does not answer at ${PONTE}: the Dice Sanctum is off. It starts with \`npm start\` in the dice-sanctum folder, or with the table skill of the Dice Sanctum plugin.`;

const ISTRUZIONI = `Dice Sanctum: the 3D dice table where ${GIOCATORE} rolls the dice of their character. It serves the DM session only; do not use it in other sessions.
- The rolls of ${GIOCATORE} reach the conversation by themselves as <channel source="dice-sanctum" ...>, as soon as the dice stop, once each (when the session was started with the Dice Sanctum channel). Without the channel, follow the roll log with the Monitor tool, as the project README explains.
- For a roll of the character use request_player_roll with wait_seconds (up to ${ATTESA_MASSIMA}): the roll comes back in the same call; if the time runs out, it arrives later through the channel.
- For the DM's own dice (monsters, companions, hidden checks) use dm_roll. Open rolls land on the table in the DM's dice, where ${GIOCATORE} watches them; with secret: true they stay behind the screen. Put the rolls of one turn in one call (attack and damage together): they land in a single throw. dm_roll never rolls the dice of ${GIOCATORE} and never fulfils a request.
- The DM's dice are yours to choose with choose_dm_dice: the set that suits you and the story. The set you hold disappears from the sets ${GIOCATORE} can pick, so your dice and theirs never look alike; the choice lasts until you change it.
- When ${GIOCATORE} cannot be at the table and asks you to roll for them, use roll_for_player: the bridge rolls the character's dice with the same physics, the table shows them in the player's own dice, and the roll log keeps them as rolls of ${GIOCATORE} made by the DM. Use it only on their word (for one roll, or until they say they are back at the table), never on your own initiative, and tell them each result as you would read it off the table.
- A free roll does not fulfil a request. If ${GIOCATORE} wants to roll a different formula, cancel with cancel_player_roll and ask again.
- get_rolls(since_seq) recovers what is missing after an interruption; get_status says whether the table is open and which requests are waiting.`;

class PonteSpento extends Error {}

/** Una chiamata al ponte: il JSON della risposta e il codice HTTP. Ponte irraggiungibile: PonteSpento. */
async function chiama<T>(metodo: 'GET' | 'POST', percorso: string, corpo?: unknown, signal?: AbortSignal): Promise<{ codice: number; dato: T }> {
  let r: Response;
  try {
    r = await fetch(PONTE + percorso, {
      method: metodo,
      headers: metodo === 'POST' ? { 'Content-Type': 'application/json' } : {},
      body: metodo === 'POST' ? JSON.stringify(corpo ?? {}) : undefined,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new PonteSpento(SPENTO);
  }
  const testo = await r.text();
  let dato: unknown;
  try {
    dato = JSON.parse(testo);
  } catch {
    dato = { errore: testo.slice(0, 200) };
  }
  return { codice: r.status, dato: dato as T };
}

const testo = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });
const errore = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }], isError: true });
const ora = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function naturali(t: TiroCompletato | TiroDelMaster): string {
  return t.nat20 ? ' · NATURAL 20' : t.nat1 ? ' · NATURAL 1' : '';
}

/** Come è caduto un tiro del master: sul tavolo, dietro lo schermo, o senza nessuno a guardare. */
function doveDelMaster(t: TiroDelMaster): string {
  return t.secret ? 'behind the screen' : t.shown ? 'on the table' : 'no table connected';
}

/** Un evento in una riga, come lo legge il DM. */
function riga(e: Evento): string {
  if (e.type === 'roll.completed') {
    const per = e.rolledBy === 'dm' ? `rolled by the DM for ${GIOCATORE}` : e.requestId ? `for ${e.requestId}` : 'free roll';
    return `#${e.seq} ${ora(e.at)} ${per} · ${e.summary}${naturali(e)}`;
  }
  if (e.type === 'dm.roll.completed') return `#${e.seq} ${ora(e.at)} DM roll, ${doveDelMaster(e)} · ${e.summary}${naturali(e)}`;
  if (e.type === 'request.created') return `#${e.seq} ${ora(e.at)} request ${e.requestId} · ${e.label}, ${e.formula}`;
  return `#${e.seq} ${ora(e.at)} cancelled ${e.requestId}`;
}

/** Quello che è andato storto, in una frase per il DM. */
function guasto(e: unknown): CallToolResult {
  if (e instanceof PonteSpento) return errore(e.message);
  return errore(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
}

const server = new McpServer(
  { name: 'dice-sanctum', version: '0.3.0' },
  {
    // La chiave dei canali di Claude Code: con questa la sessione ascolta le notifiche del server.
    capabilities: { experimental: { 'claude/channel': {} } },
    instructions: ISTRUZIONI,
  },
);

// ---- consegna: ogni tiro una volta sola ----

/** Tiri già usciti dal canale. */
const spinti = new Set<number>();
/** Tiri restituiti dalle chiamate di questo server. */
const consegnatiDaMe = new Set<number>();
/** Le attese di questo server, per richiesta: un'attesa interrotta lascia il suo tiro al canale. */
const attese = new Map<string, 'attiva' | 'interrotta' | 'chiusa'>();
let ultimoVisto: number | null = null;
let inizializzato = false;

async function spingi(t: TiroCompletato): Promise<void> {
  if (spinti.has(t.seq) || consegnatiDaMe.has(t.seq) || !inizializzato) return;
  spinti.add(t.seq);
  const chi = t.requestId ? `Requested roll (${t.requestId}), arrived after the wait` : `Free roll by ${GIOCATORE}`;
  const meta: Record<string, string> = { seq: String(t.seq), kind: t.requestId ? 'requested' : 'free', total: String(t.total) };
  if (t.requestId) meta.request_id = t.requestId;
  // Una notifica fuori dallo schema MCP: l'SDK la manda così com'è.
  const grezzo = server.server as unknown as { notification(n: { method: string; params: unknown }): Promise<void> };
  try {
    await grezzo.notification({ method: 'notifications/claude/channel', params: { content: `${chi}: ${t.summary}${naturali(t)}`, meta } });
  } catch (e) {
    spinti.delete(t.seq);
    console.error(`channel: notification not sent for seq ${t.seq}: ${String(e)}`);
  }
}

/**
 * Dopo un'attesa interrotta. Se il tiro è caduto proprio mentre la chiamata si interrompeva, il ponte
 * l'ha dato per consegnato e il feed l'ha già passato oltre: lo si chiede al ponte e va al canale.
 */
async function recupera(requestId: string): Promise<void> {
  try {
    const { codice, dato } = await chiama<RispostaAttesa>('POST', `/api/richieste/${requestId}/attendi`, { secondi: 0 });
    if (codice === 200 && dato.stato === 'tirato') await spingi(dato.tiro);
  } catch {
    // Ponte spento: al ritorno il feed riparte dall'ultimo seq visto e porta il tiro quando cade. Se il
    // feed l'aveva già passato come consegnato, il tiro resta nel registro e get_rolls lo trova.
  }
}

function dalFeed(r: DalFeed): void {
  const e = r.evento;
  ultimoVisto = Math.max(ultimoVisto ?? 0, e.seq);
  if (e.type !== 'roll.completed') return;
  // Un tiro fatto dal DM al posto di chi gioca è uscito nella risposta alla sua chiamata: mai dal canale.
  if (e.rolledBy === 'dm') return;
  if (r.consegnato) {
    // Uscito nella risposta a un'attesa: di questo server (che lo restituisce o, se interrotta,
    // lo spinge da sé) o di un'altra sessione. Al canale va soltanto se l'attesa qui si è interrotta.
    if (!e.requestId || attese.get(e.requestId) !== 'interrotta') return;
  }
  void spingi(e);
}

/** Il feed del ponte, con la ripresa da dove si era rimasti; la prima volta dagli eventi dall'avvio. */
function apriFeed(tentativo = 0): void {
  const base = PONTE.replace(/^http/, 'ws');
  const da = ultimoVisto === null ? `dal=${encodeURIComponent(AVVIO)}` : `dopo=${ultimoVisto}`;
  const ws = new WebSocket(`${base}/feed?${da}`);
  let aperto = false;
  ws.on('open', () => {
    aperto = true;
  });
  ws.on('message', (dati) => {
    try {
      dalFeed(JSON.parse(dati.toString()) as DalFeed);
    } catch (e) {
      console.error(`feed: unreadable line: ${String(e)}`);
    }
  });
  ws.on('error', () => {
    // Il ponte spento è normale: si riprova in silenzio.
  });
  ws.on('close', () => {
    const prossimo = aperto ? 0 : tentativo + 1;
    setTimeout(() => apriFeed(prossimo), Math.min(1000 * 2 ** Math.min(prossimo, 3), 8000));
  });
}

// ---- gli strumenti ----

server.registerTool(
  'get_status',
  {
    title: 'Dice Sanctum status',
    description: 'Whether the bridge answers, how many tables (browser pages) are connected, the last seq of the roll log and the open requests.',
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      const { dato } = await chiama<RispostaStato>('GET', '/api/stato');
      // Un ponte di prima della scelta non dice la serie del master: tiene quella di partenza.
      const dadi = eSerie(dato.dadiDelMaster) ? dato.dadiDelMaster : SERIE_DEL_MASTER_DI_PARTENZA;
      const righe = [
        `Bridge: on at ${PONTE}.`,
        dato.tavoli === 0
          ? 'Tables connected: none (no browser has the Dice Sanctum open).'
          : `Tables connected: ${dato.tavoli}.`,
        `Last seq: ${dato.ultimoSeq}.`,
        dato.richiesteAperte.length === 0
          ? 'Open requests: none.'
          : `Open requests (oldest first): ${dato.richiesteAperte.map((r) => `${r.requestId} ${r.label}, ${r.formula}, asked at ${ora(r.at)}`).join('; ')}.`,
        `DM's dice: ${dadi} (${ASPETTO_DELLA_SERIE[dadi]}).`,
      ];
      return testo(righe.join('\n'));
    } catch (e) {
      if (e instanceof PonteSpento) return testo(`Bridge: off. ${SPENTO}`);
      return guasto(e);
    }
  },
);

server.registerTool(
  'get_rolls',
  {
    title: 'Roll log events',
    description:
      "The events of the roll log after since_seq (the player's rolls, the DM's rolls, requests, cancellations), one per line with their seq; without arguments, the last 10. It recovers what is missing after an interruption; while they land, the player's rolls arrive through the channel.",
    inputSchema: {
      since_seq: z.number().int().min(0).optional().describe('the events with a seq greater than this'),
      limit: z.number().int().min(1).max(500).optional().describe('how many at most (10 without since_seq, 100 with it)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ since_seq, limit }) => {
    const p = new URLSearchParams();
    if (since_seq !== undefined) p.set('dopo', String(since_seq));
    if (limit !== undefined) p.set('limite', String(limit));
    try {
      const { codice, dato } = await chiama<RispostaEventi & RispostaErrore>('GET', `/api/eventi?${p}`);
      if (codice !== 200) return errore(dato.errore);
      const corpo = dato.eventi.length === 0 ? 'No events.' : dato.eventi.map(riga).join('\n');
      return testo(`${corpo}\nLast seq of the roll log: ${dato.ultimoSeq}.`);
    } catch (e) {
      return guasto(e);
    }
  },
);

server.registerTool(
  'request_player_roll',
  {
    title: `Ask ${GIOCATORE} for a roll`,
    description: `Puts the notice "The DM asks: <label>, <formula>" on the table of ${GIOCATORE}, with a ROLL button that rolls exactly that formula. With wait_seconds (0 to ${ATTESA_MASSIMA}) it waits for the roll and returns it in the same call; when the time runs out it answers "Waiting" and the roll arrives later through the channel. Several requests queue up, the oldest on top. With no table connected: error.`,
    inputSchema: {
      formula: z.string().min(1).max(200).describe('dice notation: 1d20+3, 2d20kh1+5, 4d6kh3, 8d6, 1d100'),
      label: z.string().min(1).max(80).describe('what the character rolls, in the language of the game: Constitution saving throw, Longsword attack'),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(ATTESA_MASSIMA)
        .optional()
        .describe(`how long to wait for the roll, in seconds (0 for no wait, at most ${ATTESA_MASSIMA}: beyond 120 Claude Code moves the call to the background)`),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ formula, label, wait_seconds }, extra) => {
    try {
      leggiFormula(formula);
    } catch (e) {
      return errore(`invalid formula: ${e instanceof ErroreFormula ? e.message : String(e)}`);
    }
    let creata;
    try {
      const { codice, dato } = await chiama<RispostaRichiesta & RispostaErrore>('POST', '/api/richieste', { formula, label });
      if (codice !== 200) return errore(dato.errore);
      creata = dato.richiesta;
    } catch (e) {
      return guasto(e);
    }
    const sul = `${creata.requestId} (${creata.label}, ${creata.formula})`;
    const secondi = wait_seconds ?? 0;
    if (secondi === 0) return testo(`Request ${sul} is on the table of ${GIOCATORE}. The roll will arrive through the channel.`);
    attese.set(creata.requestId, 'attiva');
    let risposta: RispostaAttesa;
    try {
      const { codice, dato } = await chiama<RispostaAttesa & RispostaErrore>(
        'POST',
        `/api/richieste/${creata.requestId}/attendi`,
        { secondi },
        extra.signal,
      );
      if (codice !== 200) {
        attese.set(creata.requestId, 'interrotta');
        return errore(`${sul}: ${dato.errore}. The request stays on the table.`);
      }
      risposta = dato;
    } catch (e) {
      // Chiamata annullata dal DM o ponte caduto durante l'attesa: il tiro, quando cade, va al canale.
      attese.set(creata.requestId, 'interrotta');
      void recupera(creata.requestId);
      if (extra.signal.aborted) return errore(`wait interrupted: request ${sul} stays on the table`);
      return errore(`the bridge stopped during the wait: request ${sul} stays open and the roll will arrive through the channel`);
    }
    if (risposta.stato === 'tirato') {
      const t = risposta.tiro;
      if (extra.signal.aborted) {
        attese.set(creata.requestId, 'interrotta');
        void spingi(t);
        return errore('wait interrupted');
      }
      consegnatiDaMe.add(t.seq);
      attese.set(creata.requestId, 'chiusa');
      return testo(`${GIOCATORE_IN_TESTA} rolled ${creata.requestId}: ${t.summary}${naturali(t)} (seq ${t.seq}).`);
    }
    attese.set(creata.requestId, 'chiusa');
    if (risposta.stato === 'annullata') return testo(`Request ${sul} was cancelled before the roll.`);
    return testo(`Waiting: ${GIOCATORE} has not rolled ${sul} yet. The roll will arrive through the channel as soon as it lands.`);
  },
);

server.registerTool(
  'cancel_player_roll',
  {
    title: 'Cancel a roll request',
    description: `Removes from the table a request that has not been rolled yet. If ${GIOCATORE} has already rolled it, it says so and reports the roll.`,
    inputSchema: { requestId: z.string().regex(/^r-\d{4,9}$/).describe('the requestId of the request, for example r-0007') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ requestId }) => {
    try {
      const { codice, dato } = await chiama<RispostaAnnulla & RispostaErrore>('POST', `/api/richieste/${requestId}/annulla`, {});
      if (codice === 200) return testo(`Request ${requestId} cancelled: it is no longer on the table.`);
      if (dato.tiro) return errore(`${dato.errore}: ${dato.tiro.summary}${naturali(dato.tiro)} (seq ${dato.tiro.seq}).`);
      return errore(dato.errore);
    } catch (e) {
      return guasto(e);
    }
  },
);

server.registerTool(
  'dm_roll',
  {
    title: "Roll the DM's dice",
    description: `Rolls the DM's own dice (monsters, companions, hidden checks) with the same physics as the table and writes them in the roll log. Open rolls land on the table of ${GIOCATORE} in the DM's dice set, and the call returns when the dice have come to rest there. With secret: true they stay behind the screen: the table shows only that the DM rolled, with no label, dice or total. Up to ${FORMULE_PER_LANCIO} formulas in one call land together in a single throw of at most ${MASSIMO_DADI_FISICI} dice (a d100 counts as two): put the rolls of one turn in one call (attack and damage, a save and the check after it) and read each result by its label. It never rolls the dice of ${GIOCATORE} and never fulfils a request_player_roll. With no table connected it rolls all the same and says that nobody saw it land.`,
    inputSchema: {
      rolls: z
        .array(
          z.object({
            formula: z.string().min(1).max(200).describe('dice notation: 1d20+4, 2d20kh1+3, 3d6, 1d100'),
            label: z.string().min(1).max(80).describe('who rolls what, in the language of the game: Wolf, bite on the paladin; the player reads it on the table when the roll is open'),
          }),
        )
        .min(1)
        .max(FORMULE_PER_LANCIO)
        .describe('the rolls of this throw, each with its own result'),
      secret: z.boolean().optional().describe('true keeps the whole throw behind the screen (default: false, on the table)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ rolls, secret }) => {
    for (const [i, r] of rolls.entries()) {
      try {
        leggiFormula(r.formula);
      } catch (e) {
        return errore(`roll ${i + 1}: invalid formula: ${e instanceof ErroreFormula ? e.message : String(e)}`);
      }
    }
    try {
      const { codice, dato } = await chiama<RispostaTiriDelMaster & RispostaErrore>('POST', '/api/master/tiri', { tiri: rolls, segreto: secret === true });
      if (codice !== 200) return errore(dato.errore);
      const primo = dato.tiri[0]!;
      const dove = primo.secret
        ? 'behind the screen'
        : dato.visto
          ? `on the table of ${GIOCATORE}`
          : `no table connected: nobody saw it land`;
      const righe = dato.tiri.map((t) => `#${t.seq} ${t.summary}${naturali(t)}`);
      return testo(`DM throw (${dove}):\n${righe.join('\n')}`);
    } catch (e) {
      return guasto(e);
    }
  },
);

server.registerTool(
  'roll_for_player',
  {
    title: `Roll in place of ${GIOCATORE}`,
    description: `Rolls the character's dice in place of ${GIOCATORE}, for when they cannot be at the table and have asked the DM to roll for them. The bridge throws with the same physics as the table and writes each roll in the roll log as a roll of ${GIOCATORE}, marked as made by the DM; a connected table shows the throw in the player's own dice, with the total where their own rolls go. It works with no table connected, and returns the results in the same call (they do not come through the channel). Use it only on the word of ${GIOCATORE}: for a single roll they ask for, or from when they say they are away until they say they are back. It does not fulfil an open request: cancel that one with cancel_player_roll. Up to ${FORMULE_PER_LANCIO} rolls and ${MASSIMO_DADI_FISICI} dice in one throw: put the rolls of one action together (attack and damage).`,
    inputSchema: {
      rolls: z
        .array(
          z.object({
            formula: z.string().min(1).max(200).describe('dice notation: 1d20+3, 2d20kh1+5, 4d6kh3, 8d6, 1d100'),
            label: z.string().min(1).max(80).describe('what the character rolls, in the language of the game: Constitution saving throw, Longsword attack'),
          }),
        )
        .min(1)
        .max(FORMULE_PER_LANCIO)
        .describe('the rolls of this throw, each with its own result'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  async ({ rolls }) => {
    for (const [i, r] of rolls.entries()) {
      try {
        leggiFormula(r.formula);
      } catch (e) {
        return errore(`roll ${i + 1}: invalid formula: ${e instanceof ErroreFormula ? e.message : String(e)}`);
      }
    }
    try {
      const { codice, dato } = await chiama<RispostaTiriPerChiGioca & RispostaErrore>('POST', '/api/giocatore/tiri', { tiri: rolls });
      if (codice !== 200) return errore(dato.errore);
      const dove = dato.visto ? 'shown on their table' : 'no table connected: it is in the roll log, nobody saw it land';
      const righe = dato.tiri.map((t) => `#${t.seq} ${t.summary}${naturali(t)}`);
      const aperte =
        dato.richiesteAperte.length === 0
          ? ''
          : `\nStill open on the table, not fulfilled by this throw: ${dato.richiesteAperte.map((r) => `${r.requestId} (${r.label}, ${r.formula})`).join('; ')}. Cancel what this throw replaced.`;
      return testo(`Rolled in place of ${GIOCATORE} (${dove}):\n${righe.join('\n')}${aperte}`);
    } catch (e) {
      return guasto(e);
    }
  },
);

server.registerTool(
  'choose_dm_dice',
  {
    title: "Choose the DM's dice",
    description: `Chooses the dice set of the DM: the dice in which open dm_roll throws land on the table of ${GIOCATORE}. The set is the DM's alone: it disappears from the sets ${GIOCATORE} can pick, and if they were using it their dice move to another set. The bridge keeps the choice until the DM changes it. Physics and fairness are the same for every set. The sets: ${SERIE.map((s) => `${s} (${ASPETTO_DELLA_SERIE[s]})`).join('; ')}. Before any choice the DM rolls ${SERIE_DEL_MASTER_DI_PARTENZA}.`,
    inputSchema: {
      set: z.enum(SERIE).describe('the set the DM rolls with from now on'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ set }) => {
    try {
      const { codice, dato } = await chiama<RispostaDadiDelMaster & RispostaErrore>('POST', '/api/master/dadi', { serie: set });
      if (codice !== 200) return errore(dato.errore);
      const tavoli = dato.tavoli === 0 ? 'no table connected: a table takes it when it opens' : `the ${dato.tavoli === 1 ? 'table has' : `${dato.tavoli} tables have`} taken it already`;
      return testo(`The DM's dice are now ${dato.serie}: ${ASPETTO_DELLA_SERIE[dato.serie]} (${tavoli}). ${GIOCATORE_IN_TESTA} can no longer pick this set.`);
    } catch (e) {
      return guasto(e);
    }
  },
);

// ---- avvio ----

server.server.oninitialized = () => {
  inizializzato = true;
  const canali = server.server.getClientCapabilities()?.experimental;
  console.error(`dice-sanctum: session ready, bridge ${PONTE}, experimental client capabilities: ${JSON.stringify(canali ?? {})}`);
  apriFeed();
};
server.server.onclose = () => process.exit(0);
process.on('SIGTERM', () => process.exit(0));
await server.connect(new StdioServerTransport());
// Il trasporto dell'SDK non guarda la fine di stdin: senza questo, una sessione chiusa male lascerebbe
// il server acceso per sempre, a ricollegarsi al feed.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
