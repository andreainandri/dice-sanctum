// Strumenti comuni alle prove d'integrazione: un ponte su una cartella temporanea, un tavolo di prova
// al posto del browser, tiri costruiti col conto condiviso, il client MCP dell'SDK al posto di Claude Code.

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';
import { type OpzioniPonte, Ponte } from '../src/bridge/ponte.ts';
import { type DadoLetto, calcola } from '../src/shared/conto.ts';
import { type TiroDalTavolo, tiroDalTavolo } from '../src/shared/eventi.ts';
import { leggiFormula } from '../src/shared/notazione.ts';
import { type DalPonte } from '../src/shared/protocollo.ts';

export const dormi = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function cartellaDiProva(): { registro: string; client: string; via(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'dice-sanctum-prova-'));
  const client = join(dir, 'client');
  mkdirSync(client);
  writeFileSync(join(client, 'index.html'), '<!doctype html><title>prova</title>');
  return { registro: join(dir, 'dati', 'tiri.jsonl'), client, via: () => rmSync(dir, { recursive: true, force: true }) };
}

export async function accendiPonte(registro: string, client: string, porta = 0, altro: Partial<OpzioniPonte> = {}): Promise<Ponte> {
  const p = new Ponte({ porta, registro, cartellaClient: client, log: () => {}, ...altro });
  await p.avvia();
  return p;
}

/** Un tiro valido coi valori dati gruppo per gruppo; per un d100, [decine, unità]. */
export function tiro(
  formula: string,
  valori: (number | [number, number])[][],
  o: { requestId?: string | null; label?: string; id?: string; at?: string } = {},
): TiroDalTavolo {
  const f = leggiFormula(formula);
  const letti: DadoLetto[][] = valori.map((g) =>
    g.map((v): DadoLetto => {
      if (typeof v === 'number') return { value: v, rethrows: 0 };
      const [tens, units] = v;
      return { value: tens === 0 && units === 0 ? 100 : tens + units, tens, units, rethrows: 0 };
    }),
  );
  return tiroDalTavolo({
    id: o.id ?? randomUUID(),
    at: o.at ?? new Date().toISOString(),
    label: o.label ?? '',
    formula: f,
    requestId: o.requestId ?? null,
    conto: calcola(f, letti),
  });
}

/** Il tavolo di prova: un WebSocket con l'origine dell'app, i messaggi del ponte in una lista. */
export class TavoloDiProva {
  readonly ws: WebSocket;
  readonly stato: Extract<DalPonte, { tipo: 'stato' }>;
  private readonly arrivati: DalPonte[];

  private constructor(ws: WebSocket, arrivati: DalPonte[], stato: Extract<DalPonte, { tipo: 'stato' }>) {
    this.ws = ws;
    this.arrivati = arrivati;
    this.stato = stato;
  }

  /** Si collega e aspetta lo stato iniziale. */
  static apri(porta: number): Promise<TavoloDiProva> {
    return new Promise((ok, ko) => {
      const ws = new WebSocket(`ws://127.0.0.1:${porta}/ws`, { origin: `http://127.0.0.1:${porta}` });
      const arrivati: DalPonte[] = [];
      let fatto = false;
      ws.on('message', (d) => {
        const m = JSON.parse(d.toString()) as DalPonte;
        if (!fatto && m.tipo === 'stato') {
          fatto = true;
          ok(new TavoloDiProva(ws, arrivati, m));
          return;
        }
        arrivati.push(m);
      });
      ws.on('error', ko);
      ws.on('unexpected-response', (_req, res) => ko(new Error(`risposta ${res.statusCode}`)));
    });
  }

  manda(evento: unknown): void {
    this.ws.send(JSON.stringify({ tipo: 'tiro', evento }));
  }

  /** Il primo messaggio arrivato (o in arrivo) che soddisfa il criterio; esce dalla lista. */
  async aspetta<T extends DalPonte = DalPonte>(criterio: (m: DalPonte) => boolean, ms = 3000): Promise<T> {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
      const i = this.arrivati.findIndex(criterio);
      if (i >= 0) return this.arrivati.splice(i, 1)[0] as T;
      await dormi(10);
    }
    throw new Error(`nessun messaggio adatto in ${ms} ms; arrivati: ${JSON.stringify(this.arrivati).slice(0, 400)}`);
  }

  /** Manda un tiro e aspetta la risposta del ponte per quel tiro. */
  async tira(t: TiroDalTavolo): Promise<Extract<DalPonte, { tipo: 'ricevuto' | 'respinto' }>> {
    this.manda(t);
    return this.aspetta((m) => (m.tipo === 'ricevuto' || m.tipo === 'respinto') && m.id === t.id);
  }

  chiudi(): Promise<void> {
    return new Promise((ok) => {
      if (this.ws.readyState === WebSocket.CLOSED) return ok();
      this.ws.once('close', () => ok());
      this.ws.close();
    });
  }
}

export interface NotificaCanale {
  content: string;
  meta: Record<string, string>;
}

/** Il server MCP vero, lanciato come lo lancia Claude Code, col client dell'SDK; `giocatore` vuoto: il nome di serie. */
export async function clientMcp(porta: number, giocatore = '') {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/mcp/server.ts', import.meta.url))],
    env: { ...(process.env as Record<string, string>), DICE_SANCTUM_URL: `http://127.0.0.1:${porta}`, DICE_SANCTUM_PLAYER: giocatore },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'prova', version: '0.0.0' });
  const canale: NotificaCanale[] = [];
  client.fallbackNotificationHandler = async (n) => {
    if (n.method === 'notifications/claude/channel') canale.push(n.params as unknown as NotificaCanale);
  };
  await client.connect(transport);
  const chiama = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const testo = (r.content as { type: string; text: string }[]).map((c) => c.text).join('\n');
    return { testo, errore: r.isError === true };
  };
  const aspettaCanale = async (criterio: (n: NotificaCanale) => boolean, ms = 4000): Promise<NotificaCanale> => {
    const fine = Date.now() + ms;
    while (Date.now() < fine) {
      const n = canale.find(criterio);
      if (n) return n;
      await dormi(20);
    }
    throw new Error(`nessuna notifica del canale adatta in ${ms} ms; arrivate: ${JSON.stringify(canale)}`);
  };
  return { client, canale, chiama, aspettaCanale, chiudi: () => client.close() };
}
