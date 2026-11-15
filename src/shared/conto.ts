// Il conto di un tiro: dai valori letti sui dadi ai tenuti, al totale, ai naturali e alla riga breve.
// Lo stesso codice gira nel client, che lo scrive, e nel bridge, che lo rifà prima di registrare.

import { type Formula, type Lati, type ModoTieni, costante, gruppi } from './notazione.ts';

export interface DadoTirato {
  value: number;
  /** Solo d100: le due parti, decine 0..90 e unità 0..9. */
  tens?: number;
  units?: number;
  kept: boolean;
  rethrows: number;
}

export interface GruppoTirato {
  sign: 1 | -1;
  count: number;
  sides: Lati;
  keep: { mode: ModoTieni; n: number } | null;
  dice: DadoTirato[];
}

export interface Conto {
  groups: GruppoTirato[];
  constant: number;
  total: number;
  nat20: boolean;
  nat1: boolean;
}

/** Quello che il tavolo legge per un dado: il valore, le parti del d100, i ritiri. */
export interface DadoLetto {
  value: number;
  tens?: number;
  units?: number;
  rethrows: number;
}

/** Quali dadi restano, in ordine di tiro: a parità di valore vince il primo tirato. */
export function tenuti(valori: readonly number[], keep: { mode: ModoTieni; n: number } | null): boolean[] {
  const n = valori.length;
  if (!keep) return new Array<boolean>(n).fill(true);
  const indici = valori.map((_, i) => i);
  const alti = [...indici].sort((a, b) => valori[b]! - valori[a]! || a - b);
  const bassi = [...indici].sort((a, b) => valori[a]! - valori[b]! || a - b);
  const esito = new Array<boolean>(n).fill(false);
  switch (keep.mode) {
    case 'kh':
      for (const i of alti.slice(0, keep.n)) esito[i] = true;
      break;
    case 'kl':
      for (const i of bassi.slice(0, keep.n)) esito[i] = true;
      break;
    case 'dh':
      esito.fill(true);
      for (const i of alti.slice(0, keep.n)) esito[i] = false;
      break;
    case 'dl':
      esito.fill(true);
      for (const i of bassi.slice(0, keep.n)) esito[i] = false;
      break;
  }
  return esito;
}

/** Il conto completo. `letti` ha un elenco per gruppo, nell'ordine della formula. */
export function calcola(f: Formula, letti: readonly (readonly DadoLetto[])[]): Conto {
  const gs = gruppi(f);
  if (letti.length !== gs.length) throw new Error(`servono ${gs.length} gruppi di dadi, arrivati ${letti.length}`);
  const groups: GruppoTirato[] = gs.map((g, i) => {
    const dadi = letti[i]!;
    if (dadi.length !== g.numero) {
      throw new Error(`${g.numero}d${g.lati}: servono ${g.numero} dadi, arrivati ${dadi.length}`);
    }
    const flag = tenuti(
      dadi.map((d) => d.value),
      g.tieni,
    );
    return {
      sign: g.segno,
      count: g.numero,
      sides: g.lati,
      keep: g.tieni ? { mode: g.tieni.mode, n: g.tieni.n } : null,
      // L'ordine delle chiavi è quello del registro: value, tens, units, kept, rethrows.
      dice: dadi.map((d, k): DadoTirato =>
        g.lati === 100
          ? { value: d.value, tens: d.tens!, units: d.units!, kept: flag[k]!, rethrows: d.rethrows }
          : { value: d.value, kept: flag[k]!, rethrows: d.rethrows },
      ),
    };
  });
  const constant = costante(f);
  let total = constant;
  for (const g of groups) {
    for (const d of g.dice) if (d.kept) total += g.sign * d.value;
  }
  // Il naturale vale quando la formula tiene un solo d20, in un gruppo che si somma.
  const d20Tenuti = groups.flatMap((g) => (g.sides === 20 ? g.dice.filter((d) => d.kept).map((d) => ({ d, g })) : []));
  let nat20 = false;
  let nat1 = false;
  if (d20Tenuti.length === 1 && d20Tenuti[0]!.g.sign === 1) {
    nat20 = d20Tenuti[0]!.d.value === 20;
    nat1 = d20Tenuti[0]!.d.value === 1;
  }
  return { groups, constant, total, nat20, nat1 };
}

/** La riga breve per il DM: i dadi scartati fra parentesi. */
export function riassunto(f: Formula, c: Conto, etichetta: string): string {
  const parti: string[] = [];
  c.groups.forEach((g, i) => {
    const dadi = g.dice.map((d) => (d.kept ? String(d.value) : `(${d.value})`)).join(' ');
    const blocco = `[${dadi}]`;
    if (i === 0) parti.push(g.sign === -1 ? `-${blocco}` : blocco);
    else parti.push(`${g.sign === -1 ? '-' : '+'} ${blocco}`);
  });
  if (c.constant !== 0) parti.push(c.constant > 0 ? `+${c.constant}` : `${c.constant}`);
  const testa = etichetta.trim() ? `${etichetta.trim()} ${f.testo}` : f.testo;
  return `${testa}: ${parti.join(' ')} = ${c.total}`;
}

/** Valori ammessi per un dado di un gruppo. */
export function valoreAmmesso(lati: Lati, d: DadoLetto): boolean {
  if (!Number.isInteger(d.value)) return false;
  if (lati === 100) {
    const t = d.tens;
    const u = d.units;
    if (t === undefined || u === undefined) return false;
    if (!Number.isInteger(t) || !Number.isInteger(u)) return false;
    if (t < 0 || t > 90 || t % 10 !== 0 || u < 0 || u > 9) return false;
    return d.value === (t === 0 && u === 0 ? 100 : t + u);
  }
  return d.value >= 1 && d.value <= lati;
}
