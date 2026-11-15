// Il server MCP del Dice Sanctum, su stdio. Quattro strumenti per il DM e, nelle sessioni che aprono il
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
import { type Evento, type TiroCompletato } from '../shared/eventi.ts';
import { ErroreFormula, leggiFormula } from '../shared/notazione.ts';
import {
  ATTESA_MASSIMA,
  type DalFeed,
  PORTA_DEL_PONTE,
  type RispostaAnnulla,
  type RispostaAttesa,
  type RispostaErrore,
  type RispostaEventi,
  type RispostaRichiesta,
  type RispostaStato,
} from '../shared/protocollo.ts';

const PONTE = (process.env.DICE_SANCTUM_URL ?? `http://127.0.0.1:${PORTA_DEL_PONTE}`).replace(/\/+$/, '');
const AVVIO = new Date().toISOString();
// Una riga sola e corta: il nome entra nei testi e nelle istruzioni della sessione.
const GIOCATORE = (process.env.DICE_SANCTUM_PLAYER ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || 'the player';
/** Il giocatore in testa di frase. */
const GIOCATORE_IN_TESTA = GIOCATORE.charAt(0).toUpperCase() + GIOCATORE.slice(1);
const SPENTO = `The bridge does not answer at ${PONTE}: the Dice Sanctum is off. It starts with \`npm start\` in the dice-sanctum folder.`;

const ISTRUZIONI = `Dice Sanctum: the 3D dice table where ${GIOCATORE} rolls the dice of their character. It serves the DM session only; do not use it in other sessions.
- The rolls of ${GIOCATORE} reach the conversation by themselves as <channel source="dice-sanctum" ...>, as soon as the dice stop, once each (when the session was started with the Dice Sanctum channel). Without the channel, follow the roll log with the Monitor tool, as the project README explains.
- For a roll of the character use request_player_roll with wait_seconds (up to ${ATTESA_MASSIMA}): the roll comes back in the same call; if the time runs out, it arrives later through the channel. Do not ask the table for the DM's own rolls: they stay behind the screen.
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

function naturali(t: TiroCompletato): string {
  return t.nat20 ? ' · NATURAL 20' : t.nat1 ? ' · NATURAL 1' : '';
}

/** Un evento in una riga, come lo legge il DM. */
function riga(e: Evento): string {
  if (e.type === 'roll.completed') {
    const per = e.requestId ? `for ${e.requestId}` : 'free roll';
    return `#${e.seq} ${ora(e.at)} ${per} · ${e.summary}${naturali(e)}`;
  }
  if (e.type === 'request.created') return `#${e.seq} ${ora(e.at)} request ${e.requestId} · ${e.label}, ${e.formula}`;
  return `#${e.seq} ${ora(e.at)} cancelled ${e.requestId}`;
}

/** Quello che è andato storto, in una frase per il DM. */
function guasto(e: unknown): CallToolResult {
  if (e instanceof PonteSpento) return errore(e.message);
  return errore(`unexpected error: ${e instanceof Error ? e.message : String(e)}`);
}

const server = new McpServer(
  { name: 'dice-sanctum', version: '0.1.0' },
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
      const righe = [
        `Bridge: on at ${PONTE}.`,
        dato.tavoli === 0
          ? 'Tables connected: none (no browser has the Dice Sanctum open).'
          : `Tables connected: ${dato.tavoli}.`,
        `Last seq: ${dato.ultimoSeq}.`,
        dato.richiesteAperte.length === 0
          ? 'Open requests: none.'
          : `Open requests (oldest first): ${dato.richiesteAperte.map((r) => `${r.requestId} ${r.label}, ${r.formula}, asked at ${ora(r.at)}`).join('; ')}.`,
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
      'The events of the roll log after since_seq (rolls, requests, cancellations), one per line with their seq; without arguments, the last 10. It recovers what is missing after an interruption; while they land, rolls arrive through the channel.',
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
