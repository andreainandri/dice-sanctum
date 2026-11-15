// Gli eventi del registro: tre tipi, una riga JSON compatta ciascuno.
// Le chiavi escono nell'ordine dell'esempio del PROMPT; il seq lo assegna soltanto il ponte.

import { type Conto, type GruppoTirato, riassunto } from './conto.ts';
import { type Formula } from './notazione.ts';

export interface RichiestaCreata {
  v: 1;
  seq: number;
  type: 'request.created';
  requestId: string;
  at: string;
  formula: string;
  label: string;
}

export interface TiroCompletato {
  v: 1;
  seq: number;
  type: 'roll.completed';
  /** Lo genera il tavolo: il ponte scarta i doppioni con questo. */
  id: string;
  at: string;
  summary: string;
  label: string;
  formula: string;
  /** La richiesta del DM che il tiro soddisfa; null per i tiri liberi. */
  requestId: string | null;
  groups: GruppoTirato[];
  constant: number;
  total: number;
  nat20: boolean;
  nat1: boolean;
}

export interface RichiestaAnnullata {
  v: 1;
  seq: number;
  type: 'request.cancelled';
  requestId: string;
  at: string;
}

export type Evento = RichiestaCreata | TiroCompletato | RichiestaAnnullata;

/** Il tiro come lo manda il tavolo: tutto tranne il seq. */
export type TiroDalTavolo = Omit<TiroCompletato, 'seq'>;

export function tiroDalTavolo(a: {
  id: string;
  at: string;
  label: string;
  formula: Formula;
  requestId: string | null;
  conto: Conto;
}): TiroDalTavolo {
  return {
    v: 1,
    type: 'roll.completed',
    id: a.id,
    at: a.at,
    summary: riassunto(a.formula, a.conto, a.label),
    label: a.label,
    formula: a.formula.testo,
    requestId: a.requestId,
    groups: a.conto.groups,
    constant: a.conto.constant,
    total: a.conto.total,
    nat20: a.conto.nat20,
    nat1: a.conto.nat1,
  };
}

/** Mette il seq subito dopo la v, dove lo vuole il registro (un seq già presente si sostituisce). */
export function numera<T extends { v: 1 }>(e: T, seq: number): T & { seq: number } {
  const { v, seq: _vecchio, ...resto } = e as T & { seq?: number };
  return { v, seq, ...resto } as unknown as T & { seq: number };
}
