// Il ponte: un processo Node che serve la pagina, parla col tavolo su WebSocket, risponde al server
// MCP su HTTP e scrive il registro. Ascolta soltanto su 127.0.0.1. Messaggi e log in inglese.
//
//   /ws          il tavolo (il browser): stato all'arrivo, eventi dal vivo, tiri da registrare
//   /feed        gli eventi per il server MCP: quelli dopo ?dopo=seq (o dal ?dal=ora), poi dal vivo
//   /api/...     stato, eventi, richieste di tiro, attese e annullamenti
//   il resto     i file della pagina, da dist/client

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { type Evento, type RichiestaCreata, type TiroCompletato } from '../shared/eventi.ts';
import { ErroreFormula, leggiFormula } from '../shared/notazione.ts';
import {
  ATTESA_MASSIMA,
  type DalFeed,
  type DalPonte,
  type ProblemaRichiesta,
  type RispostaAttesa,
  type RispostaStato,
} from '../shared/protocollo.ts';
import { Registro } from './registro.ts';
import { ID_RICHIESTA, TiroRespinto, verificaTiro } from './verifica.ts';

const CARICO_MASSIMO = 64 * 1024;
/** Quanti tiri tornano in cronaca quando un tavolo si collega. */
const CRONACA_AL_COLLEGAMENTO = 200;
const BATTITO_MS = 15000;

export interface OpzioniPonte {
  /** 0 per una porta libera qualsiasi (le prove). */
  porta: number;
  registro: string;
  cartellaClient: string;
  log?: (riga: string) => void;
}

interface Attesa {
  res: ServerResponse;
  richiesta: RichiestaCreata;
  timer: NodeJS.Timeout;
}

const TIPI: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

class ErroreHttp extends Error {
  readonly codice: number;
  readonly extra: Record<string, unknown>;
  constructor(codice: number, messaggio: string, extra: Record<string, unknown> = {}) {
    super(messaggio);
    this.codice = codice;
    this.extra = extra;
  }
}

const vivo = new WeakMap<WebSocket, boolean>();

/** Un testo arrivato da fuori, su una riga sola del log: niente righe finte. */
const inRiga = (t: string) => t.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');

export class Ponte {
  readonly registro: Registro;
  private readonly opzioni: OpzioniPonte;
  private readonly log: (riga: string) => void;
  private readonly server: Server;
  private readonly wssTavolo = new WebSocketServer({ noServer: true, maxPayload: CARICO_MASSIMO });
  private readonly wssFeed = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  private readonly tavoli = new Set<WebSocket>();
  private readonly feed = new Set<WebSocket>();
  private readonly attese = new Map<string, Attesa[]>();
  /** I tiri usciti nella risposta a un'attesa: il feed li segna, così il DM non li riceve due volte. */
  private readonly consegnati = new Set<number>();
  /** Il feed esce in ordine di seq anche quando un tiro aspetta l'esito della sua consegna. */
  private codaFeed: Promise<void> = Promise.resolve();
  private battito: NodeJS.Timeout | null = null;
  private portaVera = 0;

  constructor(opzioni: OpzioniPonte) {
    this.opzioni = opzioni;
    this.log = opzioni.log ?? ((r) => console.log(`${new Date().toISOString()} ${r}`));
    this.registro = new Registro(opzioni.registro);
    for (const s of this.registro.scartate) this.log(`roll log: line ${s.riga} unreadable, skipped: ${inRiga(s.testo)}`);
    this.server = createServer((req, res) => {
      this.gestisci(req, res).catch((e: unknown) => this.rispondiErrore(res, e));
    });
    this.server.on('upgrade', (req, socket, testa) => {
      const via = (codice: number, motivo: string) => {
        socket.end(`HTTP/1.1 ${codice} ${motivo}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      };
      socket.on('error', () => socket.destroy());
      if (!this.ospiteGiusto(req)) return via(403, 'Forbidden');
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://127.0.0.1');
      } catch {
        return via(400, 'Bad Request');
      }
      const origine = req.headers.origin;
      if (url.pathname === '/ws') {
        // Il tavolo è una pagina: il browser manda sempre l'Origin, e deve essere quella dell'app.
        if (!origine || !this.origineDellApp(origine)) return via(403, 'Forbidden');
        this.wssTavolo.handleUpgrade(req, socket, testa, (ws) => this.nuovoTavolo(ws));
      } else if (url.pathname === '/feed') {
        // Il server MCP non è una pagina e non manda Origin; una pagina estranea sì.
        if (origine && !this.origineDellApp(origine)) return via(403, 'Forbidden');
        const partenza = this.partenzaDelFeed(url.searchParams);
        this.wssFeed.handleUpgrade(req, socket, testa, (ws) => this.nuovoFeed(ws, partenza));
      } else {
        via(404, 'Not Found');
      }
    });
  }

  /** Avvia l'ascolto; risolve con la porta vera. */
  avvia(): Promise<number> {
    return new Promise((ok, ko) => {
      this.server.once('error', ko);
      this.server.listen(this.opzioni.porta, '127.0.0.1', () => {
        this.server.off('error', ko);
        const a = this.server.address();
        this.portaVera = typeof a === 'object' && a ? a.port : this.opzioni.porta;
        // I collegamenti morti senza chiudersi (un portatile sospeso) escono dal conto.
        this.battito = setInterval(() => this.ascoltaBattito(), BATTITO_MS);
        this.log(
          `bridge listening on http://127.0.0.1:${this.portaVera}, roll log ${this.opzioni.registro} ` +
            `(${this.registro.quantiEventi} events, last seq ${this.registro.ultimoSeq})`,
        );
        ok(this.portaVera);
      });
    });
  }

  get porta(): number {
    return this.portaVera;
  }

  /** Chi aspetta riceve «in attesa» (la richiesta resta aperta nel registro), poi si chiude tutto. */
  async ferma(): Promise<void> {
    if (this.battito) clearInterval(this.battito);
    for (const lista of [...this.attese.values()]) {
      for (const a of [...lista]) {
        this.togliAttesa(a);
        this.json(a.res, 200, { stato: 'in attesa', richiesta: a.richiesta } satisfies RispostaAttesa);
      }
    }
    for (const ws of [...this.tavoli, ...this.feed]) ws.terminate();
    const chiuso = new Promise<void>((ok) => this.server.close(() => ok()));
    this.server.closeAllConnections();
    await chiuso;
    await this.codaFeed;
    this.registro.chiudi();
    this.log('bridge stopped');
  }

  // ---- sicurezza ----

  private origineDellApp(origine: string): boolean {
    return origine === `http://127.0.0.1:${this.portaVera}` || origine === `http://localhost:${this.portaVera}`;
  }

  /** Contro il DNS rebinding: un nome qualsiasi che punta a 127.0.0.1 non passa. */
  private ospiteGiusto(req: IncomingMessage): boolean {
    const h = req.headers.host;
    return h === `127.0.0.1:${this.portaVera}` || h === `localhost:${this.portaVera}`;
  }

  // ---- HTTP ----

  private async gestisci(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.ospiteGiusto(req)) throw new ErroreHttp(403, 'host not allowed');
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      throw new ErroreHttp(400, 'invalid address');
    }
    if (!url.pathname.startsWith('/api/')) return this.file(url.pathname, req, res);
    // Una pagina web qualsiasi aperta nel browser manda il suo Origin: fuori.
    const origine = req.headers.origin;
    if (origine && !this.origineDellApp(origine)) throw new ErroreHttp(403, 'origin not allowed');
    const metodo = req.method ?? 'GET';
    if (metodo === 'GET' && url.pathname === '/api/stato') return this.json(res, 200, this.stato());
    if (metodo === 'GET' && url.pathname === '/api/eventi') return this.eventi(url.searchParams, res);
    if (metodo === 'POST') {
      const corpo = await this.corpo(req);
      if (url.pathname === '/api/richieste') return this.chiedi(corpo, res);
      const m = /^\/api\/richieste\/([^/]+)\/(attendi|annulla)$/.exec(url.pathname);
      if (m) {
        const requestId = m[1]!;
        if (!ID_RICHIESTA.test(requestId)) throw new ErroreHttp(400, 'invalid requestId');
        return m[2] === 'attendi' ? this.attendi(requestId, corpo, res) : this.annulla(requestId, res);
      }
    }
    throw new ErroreHttp(404, 'not found');
  }

  private async corpo(req: IncomingMessage): Promise<Record<string, unknown>> {
    const tipo = req.headers['content-type'] ?? '';
    if (!/^application\/json(\s*;|$)/i.test(tipo)) throw new ErroreHttp(415, 'Content-Type must be application/json');
    const pezzi: Buffer[] = [];
    let lunghezza = 0;
    for await (const pezzo of req) {
      lunghezza += (pezzo as Buffer).length;
      if (lunghezza > CARICO_MASSIMO) throw new ErroreHttp(413, 'payload over 64 KB');
      pezzi.push(pezzo as Buffer);
    }
    let dato: unknown;
    try {
      dato = JSON.parse(Buffer.concat(pezzi).toString('utf8') || '{}');
    } catch {
      throw new ErroreHttp(400, 'invalid JSON');
    }
    if (typeof dato !== 'object' || dato === null || Array.isArray(dato)) throw new ErroreHttp(400, 'a JSON object is required');
    return dato as Record<string, unknown>;
  }

  private json(res: ServerResponse, codice: number, dato: unknown): void {
    if (res.headersSent || res.destroyed) return;
    const testo = JSON.stringify(dato);
    res.writeHead(codice, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(testo),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(testo);
  }

  private rispondiErrore(res: ServerResponse, e: unknown): void {
    const codice = e instanceof ErroreHttp ? e.codice : 500;
    const messaggio = e instanceof Error ? e.message : String(e);
    if (codice === 500) this.log(`error: ${e instanceof Error ? e.stack : messaggio}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // Un carico troppo grande non si legge fino in fondo: la connessione si chiude dopo la risposta.
    if (codice === 413) res.setHeader('Connection', 'close');
    this.json(res, codice, { errore: messaggio, ...(e instanceof ErroreHttp ? e.extra : {}) });
  }

  private async file(percorso: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ErroreHttp(405, 'method not allowed');
    // resolve toglie la barra finale: con «dist/client/» il confronto qui sotto respingerebbe ogni file.
    const base = resolve(this.opzioni.cartellaClient);
    let relativo: string;
    try {
      relativo = percorso === '/' ? 'index.html' : decodeURIComponent(percorso).replace(/^\/+/, '');
    } catch {
      throw new ErroreHttp(400, 'invalid address');
    }
    const pieno = normalize(join(base, relativo));
    if (pieno !== base && !pieno.startsWith(base + sep)) throw new ErroreHttp(403, 'outside the page folder');
    let dati: Buffer;
    try {
      dati = await readFile(pieno);
    } catch {
      if (percorso === '/') throw new ErroreHttp(500, `the page is missing from ${base}: run npm run build`);
      throw new ErroreHttp(404, 'file not found');
    }
    const tipo = TIPI[extname(pieno)] ?? 'application/octet-stream';
    // I file in assets/ hanno l'impronta nel nome e si tengono; la pagina si rilegge sempre.
    const cache = relativo.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, {
      'Content-Type': tipo,
      'Content-Length': dati.length,
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      // Nessuna pagina può mettere il tavolo in una cornice e far premere TIRA con l'inganno.
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
    });
    res.end(req.method === 'HEAD' ? undefined : dati);
  }

  // ---- stato, eventi, richieste ----

  stato(): RispostaStato {
    return { tavoli: this.tavoli.size, ultimoSeq: this.registro.ultimoSeq, richiesteAperte: this.registro.richiesteAperte() };
  }

  private eventi(p: URLSearchParams, res: ServerResponse): void {
    const dopo = p.get('dopo');
    const n = dopo === null ? null : Number(dopo);
    if (n !== null && !Number.isInteger(n)) throw new ErroreHttp(400, 'dopo must be an integer');
    const chiesto = p.get('limite');
    const limite = chiesto === null ? (n === null ? 10 : 100) : Number(chiesto);
    if (!Number.isInteger(limite) || limite < 1 || limite > 500) throw new ErroreHttp(400, 'limite must be between 1 and 500');
    this.json(res, 200, { ultimoSeq: this.registro.ultimoSeq, eventi: this.registro.eventiDopo(n, limite) });
  }

  private chiedi(corpo: Record<string, unknown>, res: ServerResponse): void {
    if (typeof corpo.formula !== 'string') throw new ErroreHttp(400, 'the formula is missing');
    let formula: string;
    try {
      formula = leggiFormula(corpo.formula).testo;
    } catch (e) {
      throw new ErroreHttp(400, e instanceof ErroreFormula ? e.message : 'invalid formula');
    }
    const label = typeof corpo.label === 'string' ? corpo.label.trim() : '';
    if (label === '') throw new ErroreHttp(400, 'the label is missing: what the character rolls');
    if (label.length > 80) throw new ErroreHttp(400, 'the label is over 80 characters');
    if (this.tavoli.size === 0) {
      throw new ErroreHttp(409, 'no table connected: the Dice Sanctum page is not open (npm start opens it)');
    }
    const richiesta = this.registro.nuovaRichiesta(formula, label);
    this.log(`request ${richiesta.requestId}: ${inRiga(label)}, ${formula}`);
    this.diffondi(richiesta);
    this.json(res, 200, { richiesta });
  }

  private attendi(requestId: string, corpo: Record<string, unknown>, res: ServerResponse): void {
    const r = this.registro.richiesta(requestId);
    if (!r) throw new ErroreHttp(404, `${requestId}: unknown request`);
    const secondi = corpo.secondi === undefined ? 0 : Number(corpo.secondi);
    if (!Number.isFinite(secondi) || secondi < 0) throw new ErroreHttp(400, 'secondi must be a number of seconds');
    if (r.stato === 'soddisfatta') {
      return this.json(res, 200, { stato: 'tirato', richiesta: r.creata, tiro: r.tiro! } satisfies RispostaAttesa);
    }
    if (r.stato === 'annullata') return this.json(res, 200, { stato: 'annullata', richiesta: r.creata } satisfies RispostaAttesa);
    if (secondi === 0) return this.json(res, 200, { stato: 'in attesa', richiesta: r.creata } satisfies RispostaAttesa);
    const attesa: Attesa = {
      res,
      richiesta: r.creata,
      timer: setTimeout(() => {
        this.togliAttesa(attesa);
        this.json(res, 200, { stato: 'in attesa', richiesta: r.creata } satisfies RispostaAttesa);
      }, Math.min(secondi, ATTESA_MASSIMA) * 1000),
    };
    const lista = this.attese.get(requestId) ?? [];
    lista.push(attesa);
    this.attese.set(requestId, lista);
    // Chi chiama se ne va (il DM ha interrotto): l'attesa si chiude e il tiro andrà al feed.
    res.on('close', () => {
      if (!res.writableFinished) this.togliAttesa(attesa);
    });
  }

  private togliAttesa(a: Attesa): void {
    clearTimeout(a.timer);
    const lista = (this.attese.get(a.richiesta.requestId) ?? []).filter((x) => x !== a);
    if (lista.length) this.attese.set(a.richiesta.requestId, lista);
    else this.attese.delete(a.richiesta.requestId);
  }

  private annulla(requestId: string, res: ServerResponse): void {
    const r = this.registro.richiesta(requestId);
    if (!r) throw new ErroreHttp(404, `${requestId}: unknown request`);
    if (r.stato === 'soddisfatta') throw new ErroreHttp(409, `${requestId}: already rolled`, { tiro: r.tiro });
    if (r.stato === 'annullata') throw new ErroreHttp(409, `${requestId}: already cancelled`);
    const evento = this.registro.annulla(requestId);
    this.log(`request ${requestId} cancelled`);
    for (const a of [...(this.attese.get(requestId) ?? [])]) {
      this.togliAttesa(a);
      this.json(a.res, 200, { stato: 'annullata', richiesta: a.richiesta } satisfies RispostaAttesa);
    }
    this.diffondi(evento);
    this.json(res, 200, { evento });
  }

  // ---- il tavolo ----

  private nuovoTavolo(ws: WebSocket): void {
    this.tavoli.add(ws);
    this.log(`table connected (${this.tavoli.size})`);
    vivo.set(ws, true);
    ws.on('pong', () => vivo.set(ws, true));
    this.manda(ws, {
      tipo: 'stato',
      ultimoSeq: this.registro.ultimoSeq,
      richieste: this.registro.richiesteAperte(),
      cronaca: this.registro.ultimiTiri(CRONACA_AL_COLLEGAMENTO),
    });
    ws.on('message', (dati, binario) => {
      if (binario) return this.manda(ws, { tipo: 'respinto', id: null, motivo: 'binary message', richiesta: null });
      this.messaggioDalTavolo(ws, dati.toString());
    });
    ws.on('close', () => {
      this.tavoli.delete(ws);
      this.log(`table disconnected (${this.tavoli.size})`);
    });
    ws.on('error', () => ws.terminate());
  }

  private manda(ws: WebSocket, m: DalPonte): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  }

  private messaggioDalTavolo(ws: WebSocket, testo: string): void {
    let m: unknown;
    try {
      m = JSON.parse(testo);
    } catch {
      return this.manda(ws, { tipo: 'respinto', id: null, motivo: 'the message is not JSON', richiesta: null });
    }
    if (typeof m !== 'object' || m === null || (m as { tipo?: unknown }).tipo !== 'tiro') {
      return this.manda(ws, { tipo: 'respinto', id: null, motivo: 'unknown message', richiesta: null });
    }
    const grezzo = (m as { evento?: unknown }).evento;
    const idGrezzo = typeof grezzo === 'object' && grezzo !== null ? (grezzo as { id?: unknown }).id : null;
    const id = typeof idGrezzo === 'string' && idGrezzo.length <= 64 ? idGrezzo : null;
    let tiro;
    try {
      tiro = verificaTiro(grezzo);
    } catch (e) {
      const motivo = e instanceof TiroRespinto ? e.message : 'invalid roll';
      this.log(`roll rejected${id ? ` ${inRiga(id)}` : ''}: ${inRiga(motivo)}`);
      return this.manda(ws, { tipo: 'respinto', id, motivo, richiesta: null });
    }
    // Lo stesso tiro mandato di nuovo dopo una riconnessione: è già nel registro.
    const gia = this.registro.tiroConId(tiro.id);
    if (gia) return this.manda(ws, { tipo: 'ricevuto', id: tiro.id, seq: gia.seq, doppione: true });
    if (tiro.requestId) {
      const r = this.registro.richiesta(tiro.requestId);
      const problema: ProblemaRichiesta | null = !r ? 'sconosciuta' : r.stato === 'aperta' ? null : r.stato;
      if (problema) {
        const come = { sconosciuta: 'unknown', soddisfatta: 'already fulfilled', annullata: 'cancelled' }[problema];
        const motivo = `${tiro.requestId}: request ${come}`;
        this.log(`roll rejected ${tiro.id}: ${motivo}`);
        return this.manda(ws, { tipo: 'respinto', id: tiro.id, motivo, richiesta: problema });
      }
    }
    const registrato = this.registro.registraTiro(tiro);
    this.log(`roll ${registrato.seq}: ${inRiga(registrato.summary)}${registrato.requestId ? ` (${registrato.requestId})` : ''}`);
    this.manda(ws, { tipo: 'ricevuto', id: registrato.id, seq: registrato.seq, doppione: false });
    for (const t of this.tavoli) this.manda(t, { tipo: 'evento', evento: registrato });
    const consegna = registrato.requestId ? this.consegnaAlleAttese(registrato) : Promise.resolve(false);
    this.accodaFeed(async () => {
      if (await consegna) this.consegnati.add(registrato.seq);
      this.mandaAlFeed(registrato);
    });
  }

  /** Risponde alle chiamate che aspettavano questo tiro; vero se almeno una risposta è uscita per intero. */
  private consegnaAlleAttese(t: TiroCompletato): Promise<boolean> {
    const lista = [...(this.attese.get(t.requestId!) ?? [])];
    const esiti = lista.map((a) => {
      this.togliAttesa(a);
      if (a.res.destroyed || a.res.writableEnded) return Promise.resolve(false);
      return new Promise<boolean>((ok) => {
        a.res.once('finish', () => ok(true));
        a.res.once('close', () => ok(a.res.writableFinished));
        this.json(a.res, 200, { stato: 'tirato', richiesta: a.richiesta, tiro: t } satisfies RispostaAttesa);
      });
    });
    return Promise.all(esiti).then((x) => x.some(Boolean));
  }

  /** Un evento nuovo a tavoli e feed, nell'ordine del registro. */
  private diffondi(e: Evento): void {
    for (const t of this.tavoli) this.manda(t, { tipo: 'evento', evento: e });
    this.accodaFeed(async () => this.mandaAlFeed(e));
  }

  private accodaFeed(passo: () => Promise<void>): void {
    this.codaFeed = this.codaFeed.then(passo).catch((e: unknown) => this.log(`feed: ${String(e)}`));
  }

  // ---- il feed per il server MCP ----

  /** Da dove riparte un feed: dopo un seq, o dagli eventi a partire da un'ora; senza niente, da adesso. */
  private partenzaDelFeed(p: URLSearchParams): { dopo: number } | { dal: number } {
    const dopo = Number(p.get('dopo'));
    if (p.has('dopo') && Number.isInteger(dopo)) return { dopo };
    const dal = Date.parse(p.get('dal') ?? '');
    if (p.has('dal') && !Number.isNaN(dal)) return { dal };
    return { dopo: this.registro.ultimoSeq };
  }

  private nuovoFeed(ws: WebSocket, partenza: { dopo: number } | { dal: number }): void {
    vivo.set(ws, true);
    ws.on('pong', () => vivo.set(ws, true));
    ws.on('error', () => ws.terminate());
    ws.on('close', () => this.feed.delete(ws));
    // Il recupero arriva fino all'ultimo evento di adesso; quelli dopo hanno già il loro turno nella
    // coda del feed, dietro a questo: nessun evento perso né doppio fra recupero e dal vivo.
    const finoA = this.registro.ultimoSeq;
    this.accodaFeed(async () => {
      const da = 'dopo' in partenza ? partenza.dopo : 0;
      for (const e of this.registro.eventiDopo(da, Number.MAX_SAFE_INTEGER)) {
        if (e.seq > finoA) break;
        if ('dal' in partenza && Date.parse(e.at) < partenza.dal) continue;
        this.mandaUno(ws, e);
      }
      if (ws.readyState === ws.OPEN) this.feed.add(ws);
    });
  }

  private mandaUno(ws: WebSocket, e: Evento): void {
    if (ws.readyState !== ws.OPEN) return;
    const riga: DalFeed = { evento: e, consegnato: e.type === 'roll.completed' && this.consegnati.has(e.seq) };
    ws.send(JSON.stringify(riga));
  }

  private mandaAlFeed(e: Evento): void {
    for (const ws of this.feed) this.mandaUno(ws, e);
  }

  private ascoltaBattito(): void {
    for (const ws of [...this.tavoli, ...this.feed]) {
      if (!vivo.get(ws)) {
        ws.terminate();
        continue;
      }
      vivo.set(ws, false);
      ws.ping();
    }
  }
}
