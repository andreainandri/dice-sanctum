// Il registro: un file JSONL che cresce soltanto, unica fonte di verità. Il seq lo assegna questo
// modulo; ogni riga va su disco (fsync) prima che qualcuno la veda. Al riavvio lo stato si
// ricostruisce rileggendo il file: ultimo seq, id già visti, richieste aperte.

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type Evento,
  type RichiestaAnnullata,
  type RichiestaCreata,
  type TiroCompletato,
  type TiroDalTavolo,
  type TiroDelMaster,
  numera,
} from '../shared/eventi.ts';

export type StatoRichiesta = 'aperta' | 'soddisfatta' | 'annullata';

export interface Richiesta {
  creata: RichiestaCreata;
  stato: StatoRichiesta;
  /** Il tiro che l'ha soddisfatta. */
  tiro: TiroCompletato | null;
}

export class Registro {
  readonly percorso: string;
  /** Righe saltate alla lettura perché illeggibili, col loro numero: finiscono nel log. */
  readonly scartate: { riga: number; testo: string }[] = [];
  private readonly eventi: Evento[] = [];
  private readonly tiriPerId = new Map<string, TiroCompletato>();
  private readonly richieste = new Map<string, Richiesta>();
  private fd: number;
  private numeroRichiesta = 0;

  constructor(percorso: string) {
    this.percorso = percorso;
    mkdirSync(dirname(percorso), { recursive: true });
    let testo = existsSync(percorso) ? readFileSync(percorso, 'utf8') : '';
    this.fd = openSync(percorso, 'a');
    // Un'ultima riga senza a capo è una scrittura interrotta: la si chiude, così la prossima riga parte pulita.
    if (testo.length > 0 && !testo.endsWith('\n')) {
      writeSync(this.fd, '\n');
      fsyncSync(this.fd);
      testo += '\n';
    }
    testo.split('\n').forEach((riga, i) => {
      if (riga.trim() === '') return;
      let e: unknown;
      try {
        e = JSON.parse(riga);
      } catch {
        this.scartate.push({ riga: i + 1, testo: riga.slice(0, 200) });
        return;
      }
      if (!this.eventoValido(e)) {
        this.scartate.push({ riga: i + 1, testo: riga.slice(0, 200) });
        return;
      }
      this.applica(e);
    });
  }

  private eventoValido(e: unknown): e is Evento {
    if (typeof e !== 'object' || e === null) return false;
    const x = e as Record<string, unknown>;
    if (x.v !== 1 || typeof x.seq !== 'number' || x.seq <= this.ultimoSeq) return false;
    return x.type === 'request.created' || x.type === 'roll.completed' || x.type === 'request.cancelled' || x.type === 'dm.roll.completed';
  }

  /** Aggiorna lo stato in memoria con un evento già numerato. */
  private applica(e: Evento): void {
    this.eventi.push(e);
    if (e.type === 'request.created') {
      this.richieste.set(e.requestId, { creata: e, stato: 'aperta', tiro: null });
      const n = Number(e.requestId.slice(2));
      if (Number.isInteger(n)) this.numeroRichiesta = Math.max(this.numeroRichiesta, n);
    } else if (e.type === 'request.cancelled') {
      const r = this.richieste.get(e.requestId);
      if (r && r.stato === 'aperta') r.stato = 'annullata';
    } else if (e.type === 'roll.completed') {
      this.tiriPerId.set(e.id, e);
      if (e.requestId) {
        const r = this.richieste.get(e.requestId);
        if (r && r.stato === 'aperta') {
          r.stato = 'soddisfatta';
          r.tiro = e;
        }
      }
    }
  }

  private scrivi<T extends Evento>(senzaSeq: Omit<T, 'seq'>): T {
    const e = numera(senzaSeq as T & { v: 1 }, this.ultimoSeq + 1) as unknown as T;
    writeSync(this.fd, JSON.stringify(e) + '\n');
    fsyncSync(this.fd);
    this.applica(e);
    return e;
  }

  get ultimoSeq(): number {
    return this.eventi.at(-1)?.seq ?? 0;
  }

  get quantiEventi(): number {
    return this.eventi.length;
  }

  tiroConId(id: string): TiroCompletato | undefined {
    return this.tiriPerId.get(id);
  }

  richiesta(requestId: string): Richiesta | undefined {
    return this.richieste.get(requestId);
  }

  /** Le richieste aperte, la più vecchia per prima. */
  richiesteAperte(): RichiestaCreata[] {
    return [...this.richieste.values()].filter((r) => r.stato === 'aperta').map((r) => r.creata);
  }

  /** Gli eventi con seq maggiore di `dopo`, al più `limite`; senza `dopo`, gli ultimi `limite`. */
  eventiDopo(dopo: number | null, limite: number): Evento[] {
    if (dopo === null) return this.eventi.slice(-limite);
    // I seq crescono sempre (una riga illeggibile saltata lascia un buco): ricerca binaria.
    let basso = 0;
    let alto = this.eventi.length;
    while (basso < alto) {
      const m = (basso + alto) >> 1;
      if (this.eventi[m]!.seq <= dopo) basso = m + 1;
      else alto = m;
    }
    return this.eventi.slice(basso, basso + limite);
  }

  /** Gli ultimi `quanti` tiri, del tavolo e del master, dal più vecchio al più nuovo. */
  ultimiTiri(quanti: number): (TiroCompletato | TiroDelMaster)[] {
    const tiri: (TiroCompletato | TiroDelMaster)[] = [];
    for (let i = this.eventi.length - 1; i >= 0 && tiri.length < quanti; i--) {
      const e = this.eventi[i]!;
      if (e.type === 'roll.completed' || e.type === 'dm.roll.completed') tiri.push(e);
    }
    return tiri.reverse();
  }

  nuovaRichiesta(formula: string, label: string): RichiestaCreata {
    const requestId = `r-${String(this.numeroRichiesta + 1).padStart(4, '0')}`;
    return this.scrivi<RichiestaCreata>({
      v: 1,
      type: 'request.created',
      requestId,
      at: new Date().toISOString(),
      formula,
      label,
    });
  }

  annulla(requestId: string): RichiestaAnnullata {
    return this.scrivi<RichiestaAnnullata>({ v: 1, type: 'request.cancelled', requestId, at: new Date().toISOString() });
  }

  /** Registra un tiro già verificato. */
  registraTiro(t: TiroDalTavolo): TiroCompletato {
    return this.scrivi<TiroCompletato>(t);
  }

  /** Registra un tiro del master: non tocca nessuna richiesta. */
  registraTiroDelMaster(t: Omit<TiroDelMaster, 'seq'>): TiroDelMaster {
    return this.scrivi<TiroDelMaster>(t);
  }

  chiudi(): void {
    closeSync(this.fd);
  }
}
