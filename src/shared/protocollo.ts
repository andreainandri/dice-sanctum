// I messaggi fra le tre parti: il tavolo (il browser) e il ponte sul WebSocket /ws, il server MCP e il
// ponte sull'API HTTP e sul WebSocket /feed.

import { type Ripresa } from '../physics/ripresa.ts';
import {
  type Evento,
  type EventoPerIlTavolo,
  type RichiestaCreata,
  type TiroCompletato,
  type TiroDalTavolo,
  type TiroDelMaster,
  type VoceDiCronaca,
} from './eventi.ts';

export const PORTA_DEL_PONTE = 4777;

/**
 * L'attesa più lunga di un tiro chiesto dal DM, in secondi. Il PROMPT dice fino a 180, ma Claude Code
 * 2.1.325 manda in sottofondo una chiamata MCP che dura più di 120 secondi: l'attesa si ferma prima.
 */
export const ATTESA_MASSIMA = 110;

/** Quante formule al più in un lancio del master. */
export const FORMULE_PER_LANCIO = 8;
/**
 * La pausa dopo un lancio del master, in millisecondi, prima che ne parta un altro: il tempo di leggere
 * i dadi fermi. La tengono il tavolo, fra due riprese in fila, e il ponte, che risponde al DM quando il
 * suo lancio si è visto fino in fondo.
 */
export const PAUSA_DOPO_IL_MASTER = 700;

/** Perché un tiro chiesto dal DM non può soddisfare la sua richiesta. */
export type ProblemaRichiesta = 'sconosciuta' | 'soddisfatta' | 'annullata';

/** Dal ponte al tavolo. */
export type DalPonte =
  /** All'arrivo: le richieste aperte e gli ultimi tiri del registro, per la cronaca. */
  | { tipo: 'stato'; ultimoSeq: number; richieste: RichiestaCreata[]; cronaca: VoceDiCronaca[] }
  /** Un evento appena scritto nel registro, da qualunque parte venga; i tiri in chiaro del master arrivano col loro lancio. */
  | { tipo: 'evento'; evento: EventoPerIlTavolo }
  /** Un lancio in chiaro del master: i suoi tiri, già nel registro, e la ripresa da mostrare coi dadi del master. */
  | { tipo: 'lancio del master'; tiri: TiroDelMaster[]; ripresa: Ripresa }
  /** Un lancio fatto dal master al posto di chi gioca: i tiri, già nel registro, e la ripresa da mostrare coi dadi di chi gioca. */
  | { tipo: 'lancio per chi gioca'; tiri: TiroCompletato[]; ripresa: Ripresa }
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

/** POST /api/master/tiri { tiri: [{ formula, label }], segreto? } */
export interface RispostaTiriDelMaster {
  tiri: TiroDelMaster[];
  /** Vero se un tavolo collegato ha mostrato il lancio. */
  visto: boolean;
}

/** POST /api/giocatore/tiri { tiri: [{ formula, label }] }: il master tira al posto di chi gioca. */
export interface RispostaTiriPerChiGioca {
  tiri: TiroCompletato[];
  /** Vero se un tavolo collegato ha mostrato il lancio. */
  visto: boolean;
  /** Le richieste rimaste aperte sul tavolo: un tiro fatto dal master non ne soddisfa nessuna. */
  richiesteAperte: RichiestaCreata[];
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
