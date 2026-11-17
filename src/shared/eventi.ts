// Gli eventi del registro: quattro tipi, una riga JSON compatta ciascuno.
// Le chiavi escono nell'ordine dichiarato qui; il seq lo assegna soltanto il ponte.

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
  /**
   * Soltanto nei tiri che il master ha fatto al posto di chi gioca, quando chi gioca non può stare al
   * tavolo: li tira il ponte, coi dadi di chi gioca, e nel registro restano tiri suoi. `throwId` unisce
   * le formule di uno stesso lancio; `shown` dice se un tavolo collegato l'ha mostrato.
   */
  rolledBy?: 'dm';
  throwId?: string;
  shown?: boolean;
}

export interface RichiestaAnnullata {
  v: 1;
  seq: number;
  type: 'request.cancelled';
  requestId: string;
  at: string;
}

/**
 * Un tiro del master. Lo tira il ponte, con la stessa fisica del tavolo; il tavolo ne mostra la ripresa
 * coi dadi del master. Più formule tirate insieme cadono nello stesso lancio e hanno lo stesso `throwId`.
 */
export interface TiroDelMaster {
  v: 1;
  seq: number;
  type: 'dm.roll.completed';
  id: string;
  at: string;
  throwId: string;
  /** Dietro lo schermo: al tavolo arriva soltanto che il master ha tirato. */
  secret: boolean;
  /** Vero quando al momento del lancio c'era un tavolo collegato che l'ha mostrato. */
  shown: boolean;
  summary: string;
  label: string;
  formula: string;
  groups: GruppoTirato[];
  constant: number;
  total: number;
  nat20: boolean;
  nat1: boolean;
}

export type Evento = RichiestaCreata | TiroCompletato | RichiestaAnnullata | TiroDelMaster;

/**
 * Un lancio segreto del master come lo vede il tavolo: né etichetta né formula né dadi né totale, e una
 * voce sola per lancio, quante che siano le formule. Non sta nel registro: lo ricava il ponte.
 */
export interface TiroCoperto {
  v: 1;
  seq: number;
  type: 'dm.roll.hidden';
  id: string;
  at: string;
  throwId: string;
}

/** Quello che il ponte manda al tavolo: i tiri segreti del master escono coperti. */
export type EventoPerIlTavolo = RichiestaCreata | TiroCompletato | RichiestaAnnullata | TiroDelMaster | TiroCoperto;

/** Una voce della cronaca del tavolo. */
export type VoceDiCronaca = TiroCompletato | TiroDelMaster | TiroCoperto;

export function copri(t: TiroDelMaster): TiroCoperto {
  return { v: 1, seq: t.seq, type: 'dm.roll.hidden', id: t.id, at: t.at, throwId: t.throwId };
}

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

/**
 * Un tiro di chi gioca fatto dal master al suo posto, tutto tranne il seq: un tiro libero, con in coda
 * chi l'ha tirato, il lancio di cui fa parte e se un tavolo l'ha mostrato.
 */
export function tiroPerChiGioca(a: { id: string; at: string; throwId: string; shown: boolean; label: string; formula: Formula; conto: Conto }): TiroDalTavolo {
  return {
    ...tiroDalTavolo({ id: a.id, at: a.at, label: a.label, formula: a.formula, requestId: null, conto: a.conto }),
    rolledBy: 'dm',
    throwId: a.throwId,
    shown: a.shown,
  };
}

/** Un tiro del master, tutto tranne il seq, con le chiavi nell'ordine del registro. */
export function tiroDelMaster(a: {
  id: string;
  at: string;
  throwId: string;
  secret: boolean;
  shown: boolean;
  label: string;
  formula: Formula;
  conto: Conto;
}): Omit<TiroDelMaster, 'seq'> {
  return {
    v: 1,
    type: 'dm.roll.completed',
    id: a.id,
    at: a.at,
    throwId: a.throwId,
    secret: a.secret,
    shown: a.shown,
    summary: riassunto(a.formula, a.conto, a.label),
    label: a.label,
    formula: a.formula.testo,
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
