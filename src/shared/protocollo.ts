// I messaggi fra le tre parti: il tavolo (il browser) e il ponte sul WebSocket /ws, il server MCP e il
// ponte sull'API HTTP e sul WebSocket /feed.

import { type Evento, type RichiestaCreata, type TiroCompletato, type TiroDalTavolo } from './eventi.ts';

export const PORTA_DEL_PONTE = 4777;

/**
 * L'attesa più lunga di un tiro chiesto dal DM, in secondi. Il PROMPT dice fino a 180, ma Claude Code
 * 2.1.325 manda in sottofondo una chiamata MCP che dura più di 120 secondi: l'attesa si ferma prima.
 */
export const ATTESA_MASSIMA = 110;

/** Perché un tiro chiesto dal DM non può soddisfare la sua richiesta. */
export type ProblemaRichiesta = 'sconosciuta' | 'soddisfatta' | 'annullata';

/** Dal ponte al tavolo. */
export type DalPonte =
  /** All'arrivo: le richieste aperte e gli ultimi tiri del registro, per la cronaca. */
  | { tipo: 'stato'; ultimoSeq: number; richieste: RichiestaCreata[]; cronaca: TiroCompletato[] }
  /** Un evento appena scritto nel registro, da qualunque parte venga. */
  | { tipo: 'evento'; evento: Evento }
  /** Il tiro è nel registro (anche quando era già arrivato prima: `doppione`). */
  | { tipo: 'ricevuto'; id: string; seq: number; doppione: boolean }
  /** Il tiro non entra nel registro. Con `richiesta` il tiro è buono e la richiesta no. */
  | { tipo: 'respinto'; id: string | null; motivo: string; richiesta: ProblemaRichiesta | null };

/** Dal tavolo al ponte. */
export type DalTavolo = { tipo: 'tiro'; evento: TiroDalTavolo };

/** Una riga del feed: `consegnato` vuol dire che il tiro è già uscito nella risposta a un'attesa. */
export interface DalFeed {
  evento: Evento;
  consegnato: boolean;
}

// L'API HTTP. Ogni errore risponde { errore } con un codice 4xx o 5xx.

export interface RispostaStato {
  tavoli: number;
  ultimoSeq: number;
  richiesteAperte: RichiestaCreata[];
}

export interface RispostaEventi {
  ultimoSeq: number;
  eventi: Evento[];
}

/** POST /api/richieste { formula, label } */
export interface RispostaRichiesta {
  richiesta: RichiestaCreata;
}

/** POST /api/richieste/:id/attendi { secondi } */
export type RispostaAttesa =
  | { stato: 'tirato'; richiesta: RichiestaCreata; tiro: TiroCompletato }
  | { stato: 'in attesa'; richiesta: RichiestaCreata }
  | { stato: 'annullata'; richiesta: RichiestaCreata };

/** POST /api/richieste/:id/annulla */
export interface RispostaAnnulla {
  evento: Evento;
}

export interface RispostaErrore {
  errore: string;
  /** Quando la richiesta da annullare era già stata tirata. */
  tiro?: TiroCompletato;
}
