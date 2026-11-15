// Notazione dei tiri: termini separati da + e -, gruppi NdX (con khK, klK, dhK, dlK) e costanti.
// Parser scritto a mano, senza eval. Ogni termine porta la sua posizione nel testo, così gli
// errori dicono dove e perché; i modificatori sono una lista, pronta per altri (esplosivi, soglie).

import { tr } from './lingua.ts';

export const LATI = [4, 6, 8, 10, 12, 20, 100] as const;
export type Lati = (typeof LATI)[number];

export type ModoTieni = 'kh' | 'kl' | 'dh' | 'dl';
export interface Tieni {
  mode: ModoTieni;
  n: number;
}

export interface TermineDadi {
  tipo: 'dadi';
  segno: 1 | -1;
  numero: number;
  lati: Lati;
  tieni: Tieni | null;
  /** Posizione nel testo originale (da 0) e lunghezza del pezzo. */
  inizio: number;
  fine: number;
}
export interface TermineCostante {
  tipo: 'costante';
  segno: 1 | -1;
  valore: number;
  inizio: number;
  fine: number;
}
export type Termine = TermineDadi | TermineCostante;

export interface Formula {
  termini: Termine[];
  /** La forma canonica: minuscole, senza spazi, numero dei dadi sempre scritto, d% come d100. */
  testo: string;
  /** Dadi fisici sul tavolo: il d100 ne conta due. */
  dadiFisici: number;
}

export const MASSIMO_DADI_FISICI = 30;
export const MASSIMO_COSTANTE = 9999;

export class ErroreFormula extends Error {
  readonly posizione: number;
  constructor(messaggio: string, posizione: number) {
    super(messaggio);
    this.name = 'ErroreFormula';
    this.posizione = posizione;
  }
}

/** Il punto del testo nei messaggi, contando da 1. */
const dove = (indice: number) => tr({ it: `posizione ${indice + 1}`, en: `position ${indice + 1}` });
/** Un pezzo della formula fra virgolette, quelle della lingua. */
const cita = (pezzo: string) => tr({ it: `«${pezzo}»`, en: `“${pezzo}”` });
/** Dopo un termine viene un segno. */
const serveSegno = (pezzo: string, indice: number) =>
  new ErroreFormula(
    tr({ it: `${cita(pezzo)} (${dove(indice)}): qui serve + o -`, en: `${cita(pezzo)} (${dove(indice)}): a + or - is needed here` }),
    indice,
  );

type Token =
  | { t: 'num'; v: number; testo: string; pos: number }
  | { t: 'd'; pos: number }
  | { t: '%'; pos: number }
  | { t: 'mod'; v: ModoTieni; pos: number }
  | { t: 'op'; v: 1 | -1; pos: number };

function tokenizza(testo: string): Token[] {
  const out: Token[] = [];
  const s = testo.toLowerCase();
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < s.length && s[j]! >= '0' && s[j]! <= '9') j++;
      const cifre = s.slice(i, j);
      out.push({ t: 'num', v: Number(cifre), testo: cifre, pos: i });
      i = j;
      continue;
    }
    if (c === '+' || c === '-') {
      out.push({ t: 'op', v: c === '+' ? 1 : -1, pos: i });
      i++;
      continue;
    }
    if (c === '%') {
      out.push({ t: '%', pos: i });
      i++;
      continue;
    }
    const due = s.slice(i, i + 2);
    if (due === 'kh' || due === 'kl' || due === 'dh' || due === 'dl') {
      out.push({ t: 'mod', v: due, pos: i });
      i += 2;
      continue;
    }
    if (c === 'd') {
      out.push({ t: 'd', pos: i });
      i++;
      continue;
    }
    if (c === 'k') {
      const qui = `${cita(testo.slice(i, i + 2))} (${dove(i)})`;
      throw new ErroreFormula(
        tr({ it: `${qui}: scrivi kh per tenere i più alti o kl per i più bassi`, en: `${qui}: write kh to keep the highest or kl to keep the lowest` }),
        i,
      );
    }
    const qui = `${cita(testo[i]!)} (${dove(i)})`;
    throw new ErroreFormula(tr({ it: `${qui}: carattere non previsto`, en: `${qui}: unexpected character` }), i);
  }
  return out;
}

/** Legge una formula; lancia ErroreFormula con un messaggio nella lingua corrente. */
export function leggiFormula(testo: string): Formula {
  const termini = terminiDi(testo);
  const tutto = testo.replace(/\s+/g, '');
  const dadiFisici = contaDadiFisici(termini);
  if (dadiFisici === 0) throw new ErroreFormula(tr({ it: `${tutto}: manca un dado, ci sono solo numeri`, en: `${tutto}: no dice, only numbers` }), 0);
  if (dadiFisici > MASSIMO_DADI_FISICI) {
    throw new ErroreFormula(
      tr({
        it: `${tutto}: ${dadiFisici} dadi sul tavolo, al massimo ${MASSIMO_DADI_FISICI} (il d100 ne conta due)`,
        en: `${tutto}: ${dadiFisici} dice on the table, at most ${MASSIMO_DADI_FISICI} (a d100 counts as two)`,
      }),
      0,
    );
  }
  return { termini, testo: canonica(termini), dadiFisici };
}

const contaDadiFisici = (termini: readonly Termine[]) =>
  termini.reduce((s, t) => s + (t.tipo === 'dadi' ? t.numero * (t.lati === 100 ? 2 : 1) : 0), 0);

/** I termini di una formula, senza i controlli sul totale dei dadi: ammette anche soli numeri. */
function terminiDi(testo: string): Termine[] {
  if (testo.length > 200) {
    throw new ErroreFormula(tr({ it: 'formula troppo lunga (al massimo 200 caratteri)', en: 'formula too long (at most 200 characters)' }), 200);
  }
  const tok = tokenizza(testo);
  if (tok.length === 0) throw new ErroreFormula(tr({ it: 'formula vuota', en: 'empty formula' }), 0);
  const pezzo = (da: number, a: number) => testo.slice(da, a).replace(/\s+/g, '');
  const termini: Termine[] = [];
  let k = 0;
  let segno: 1 | -1 = 1;

  // Un segno iniziale è ammesso: «-1d4+10».
  const primo = tok[0]!;
  if (primo.t === 'op') {
    segno = primo.v;
    k = 1;
  }

  for (;;) {
    const t = tok[k];
    if (!t) {
      const prima = tok[k - 1]!;
      const tutto = pezzo(0, testo.length);
      const segnoFinale = cita(prima.t === 'op' && prima.v === -1 ? '-' : '+');
      throw new ErroreFormula(
        tr({ it: `${tutto}: manca un dado o un numero dopo ${segnoFinale}`, en: `${tutto}: a die or a number is missing after ${segnoFinale}` }),
        testo.length,
      );
    }
    const inizio = t.pos;
    if (t.t === 'num' || t.t === 'd') {
      let numero = 1;
      let numeroScritto = false;
      if (t.t === 'num') {
        const dopo = tok[k + 1];
        if (!dopo || dopo.t !== 'd') {
          // Costante.
          if (dopo && (dopo.t === 'mod' || dopo.t === '%')) {
            const qui = `${cita(pezzo(inizio, dopo.pos + 1))} (${dove(dopo.pos)})`;
            throw new ErroreFormula(tr({ it: `${qui}: manca la d del dado`, en: `${qui}: the d of the die is missing` }), dopo.pos);
          }
          if (t.v > MASSIMO_COSTANTE) {
            throw new ErroreFormula(
              tr({ it: `${t.testo}: numero troppo grande (al massimo ${MASSIMO_COSTANTE})`, en: `${t.testo}: number too large (at most ${MASSIMO_COSTANTE})` }),
              inizio,
            );
          }
          termini.push({ tipo: 'costante', segno, valore: t.v, inizio, fine: t.pos + t.testo.length });
          k += 1;
          const op = tok[k];
          if (!op) break;
          if (op.t !== 'op') throw serveSegno(pezzo(op.pos, op.pos + 1), op.pos);
          segno = op.v;
          k += 1;
          continue;
        }
        numero = t.v;
        numeroScritto = true;
        k += 1;
      }
      // Ora tok[k] è la d.
      const d = tok[k]!;
      k += 1;
      const facce = tok[k];
      let lati: number;
      let fineGruppo: number;
      if (facce && facce.t === '%') {
        lati = 100;
        fineGruppo = facce.pos + 1;
        k += 1;
      } else if (facce && facce.t === 'num') {
        lati = facce.v;
        fineGruppo = facce.pos + facce.testo.length;
        k += 1;
      } else {
        const qui = pezzo(inizio, d.pos + 1);
        throw new ErroreFormula(tr({ it: `${qui}: manca il numero di facce dopo la d`, en: `${qui}: the number of faces is missing after the d` }), d.pos);
      }
      const scritto = pezzo(inizio, fineGruppo);
      if (!(LATI as readonly number[]).includes(lati)) {
        const qui = pezzo(d.pos, fineGruppo);
        throw new ErroreFormula(tr({ it: `${qui}: non esiste un dado da ${lati}`, en: `${qui}: there is no ${lati}-sided die` }), d.pos);
      }
      if (numeroScritto && numero === 0) {
        throw new ErroreFormula(tr({ it: `${scritto}: serve almeno un dado`, en: `${scritto}: at least one die is needed` }), inizio);
      }
      if (numero > MASSIMO_DADI_FISICI) {
        throw new ErroreFormula(
          tr({
            it: `${scritto}: troppi dadi (al massimo ${MASSIMO_DADI_FISICI} sul tavolo)`,
            en: `${scritto}: too many dice (at most ${MASSIMO_DADI_FISICI} on the table)`,
          }),
          inizio,
        );
      }
      let tieni: Tieni | null = null;
      const mod = tok[k];
      if (mod && mod.t === 'mod') {
        const n = tok[k + 1];
        if (!n || n.t !== 'num') {
          const qui = pezzo(inizio, mod.pos + 2);
          throw new ErroreFormula(tr({ it: `${qui}: manca il numero dopo ${mod.v}`, en: `${qui}: the number after ${mod.v} is missing` }), mod.pos);
        }
        fineGruppo = n.pos + n.testo.length;
        const conMod = pezzo(inizio, fineGruppo);
        const tiene = mod.v === 'kh' || mod.v === 'kl';
        if (tiene && (n.v < 1 || n.v > numero)) {
          throw new ErroreFormula(
            n.v < 1
              ? tr({ it: `${conMod}: tenere 0 dadi non ha senso`, en: `${conMod}: keeping 0 dice makes no sense` })
              : tr({ it: `${conMod}: non si tengono ${n.v} dadi su ${numero}`, en: `${conMod}: cannot keep ${n.v} dice out of ${numero}` }),
            mod.pos,
          );
        }
        if (!tiene && (n.v < 1 || n.v >= numero)) {
          throw new ErroreFormula(
            n.v < 1
              ? tr({ it: `${conMod}: scartare 0 dadi non cambia niente`, en: `${conMod}: dropping 0 dice changes nothing` })
              : tr({
                  it: `${conMod}: scartando ${n.v} dadi su ${numero} non ne resta nessuno`,
                  en: `${conMod}: dropping ${n.v} dice out of ${numero} leaves none`,
                }),
            mod.pos,
          );
        }
        tieni = { mode: mod.v, n: n.v };
        k += 2;
        const altro = tok[k];
        if (altro && altro.t === 'mod') {
          const qui = pezzo(inizio, altro.pos + 2);
          throw new ErroreFormula(tr({ it: `${qui}: un solo kh, kl, dh o dl per gruppo`, en: `${qui}: only one kh, kl, dh or dl per group` }), altro.pos);
        }
      }
      termini.push({ tipo: 'dadi', segno, numero, lati: lati as Lati, tieni, inizio, fine: fineGruppo });
      const op = tok[k];
      if (!op) break;
      if (op.t !== 'op') throw serveSegno(pezzo(inizio, op.pos + 1), op.pos);
      segno = op.v;
      k += 1;
      continue;
    }
    const qui = (scritto: string) => `${cita(scritto)} (${dove(t.pos)})`;
    if (t.t === 'op') {
      const s = qui(pezzo(Math.max(0, t.pos - 1), t.pos + 1));
      throw new ErroreFormula(tr({ it: `${s}: due segni di fila`, en: `${s}: two signs in a row` }), t.pos);
    }
    if (t.t === 'mod') {
      const s = qui(t.v);
      throw new ErroreFormula(
        tr({ it: `${s}: ${t.v} va dopo un gruppo di dadi, come in 4d6${t.v}1`, en: `${s}: ${t.v} goes after a group of dice, as in 4d6${t.v}1` }),
        t.pos,
      );
    }
    const s = qui('%');
    throw new ErroreFormula(tr({ it: `${s}: il % va dopo la d, come in d%`, en: `${s}: the % goes after the d, as in d%` }), t.pos);
  }

  return termini;
}

function canonica(termini: readonly Termine[]): string {
  return termini
    .map((t, i) => {
      const s = t.segno === -1 ? '-' : i === 0 ? '' : '+';
      if (t.tipo === 'costante') return s + t.valore;
      const tieni = t.tieni ? `${t.tieni.mode}${t.tieni.n}` : '';
      return `${s}${t.numero}d${t.lati}${tieni}`;
    })
    .join('');
}

/** Ricostruisce la formula da termini cambiati (vantaggio). */
function daTermini(termini: Termine[]): Formula {
  return leggiFormula(canonica(termini));
}

export type Vantaggio = 'vantaggio' | 'svantaggio';

/**
 * VANTAGGIO e SVANTAGGIO: il d20 della formula diventa 2d20kh1 o 2d20kl1, il resto non cambia.
 * Formula vuota: un d20 secco. Vale con un solo gruppo di d20, da uno o già in vantaggio.
 */
export function conVantaggio(testo: string, quale: Vantaggio): Formula {
  const modo: ModoTieni = quale === 'vantaggio' ? 'kh' : 'kl';
  if (testo.trim() === '') return leggiFormula(`2d20${modo}1`);
  const f = leggiFormula(testo);
  const d20 = f.termini.filter((t): t is TermineDadi => t.tipo === 'dadi' && t.lati === 20);
  const it = quale === 'vantaggio' ? 'il vantaggio' : 'lo svantaggio';
  const en = quale === 'vantaggio' ? 'advantage' : 'disadvantage';
  if (d20.length === 0) {
    throw new ErroreFormula(tr({ it: `${f.testo}: ${it} vale per un tiro di d20, e qui non ce n'è`, en: `${f.testo}: ${en} needs a d20 roll, and there is none here` }), 0);
  }
  if (d20.length > 1) {
    throw new ErroreFormula(
      tr({
        it: `${f.testo}: ci sono più gruppi di d20, ${it} non sa quale cambiare`,
        en: `${f.testo}: there are several groups of d20, ${en} cannot tell which one to change`,
      }),
      0,
    );
  }
  const g = d20[0]!;
  const giaDoppio = g.numero === 2 && g.tieni !== null && g.tieni.n === 1 && (g.tieni.mode === 'kh' || g.tieni.mode === 'kl');
  if (!(g.numero === 1 && g.tieni === null) && !giaDoppio) {
    throw new ErroreFormula(tr({ it: `${f.testo}: ${it} vale per un d20 solo`, en: `${f.testo}: ${en} applies to a single d20` }), g.inizio);
  }
  const termini = f.termini.map((t) => (t === g ? { ...g, numero: 2, tieni: { mode: modo, n: 1 } } : t));
  return daTermini(termini);
}

/** I gruppi di dadi in ordine, coi dadi fisici che chiedono al tavolo. */
export function gruppi(f: Formula): TermineDadi[] {
  return f.termini.filter((t): t is TermineDadi => t.tipo === 'dadi');
}

export function costante(f: Formula): number {
  return f.termini.reduce((s, t) => s + (t.tipo === 'costante' ? t.segno * t.valore : 0), 0);
}

/**
 * Il pannello dei dadi: un dado in più o in meno nella formula scritta. Cambia il primo gruppo
 * positivo di quel dado senza kh, kl, dh o dl; se non c'è, un dado in più apre un gruppo nuovo
 * dopo l'ultimo gruppo di dadi, prima dei numeri. Un dado in meno su un gruppo da uno lo toglie;
 * senza un gruppo da cambiare la formula resta com'è. Il risultato è in forma canonica; se resta
 * senza dadi può contenere soli numeri, che il campo tiene finché non si aggiunge un dado.
 */
export function aggiungiDado(testo: string, lati: Lati, delta: 1 | -1): string {
  const termini = testo.trim() === '' ? [] : terminiDi(testo);
  const i = termini.findIndex((t) => t.tipo === 'dadi' && t.lati === lati && t.segno === 1 && t.tieni === null);
  const gruppo = i >= 0 ? (termini[i] as TermineDadi) : null;
  if (delta === 1) {
    if (gruppo) {
      termini[i] = { ...gruppo, numero: gruppo.numero + 1 };
    } else {
      let ultimo = -1;
      termini.forEach((t, k) => {
        if (t.tipo === 'dadi') ultimo = k;
      });
      termini.splice(ultimo + 1, 0, { tipo: 'dadi', segno: 1, numero: 1, lati, tieni: null, inizio: 0, fine: 0 });
    }
  } else {
    if (!gruppo) return testo;
    if (gruppo.numero > 1) termini[i] = { ...gruppo, numero: gruppo.numero - 1 };
    else termini.splice(i, 1);
  }
  const nuova = canonica(termini);
  // Con dei dadi passa dai controlli completi: oltre trenta dadi è un errore, come scritto a mano.
  return contaDadiFisici(termini) > 0 ? leggiFormula(nuova).testo : nuova;
}

/** Quanti dadi di ogni tipo ci sono nella formula, per il pannello. */
export function contaPerLati(testo: string): Map<Lati, number> {
  const conta = new Map<Lati, number>();
  if (testo.trim() === '') return conta;
  for (const t of terminiDi(testo)) {
    if (t.tipo === 'dadi') conta.set(t.lati, (conta.get(t.lati) ?? 0) + t.numero);
  }
  return conta;
}
