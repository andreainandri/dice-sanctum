// Geometrie dei dadi e tabelle delle facce.
//
// Ogni dado nasce dai suoi vertici; le facce si ricavano dal guscio convesso, così mesh,
// collider e lettore partono dagli stessi numeri. Le unità sono centimetri.
// Il valore di una faccia sta soltanto in `letture`: il lettore lo prende da lì, e la
// grafica dipinge la stessa tabella.

import {
  type V3,
  diff,
  lunghezza,
  normalizza,
  punto,
  scala,
  somma,
  vettoriale,
} from './vettori.ts';

export type Forma = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20';
export const FORME: readonly Forma[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];

/** Il d10 compare da solo, come decine o come unità di un d100. */
export type Ruolo = 'semplice' | 'decine' | 'unita';

export interface Geometria {
  readonly forma: Forma;
  readonly vertici: readonly V3[];
  /** Indici dei vertici di ogni faccia, in senso antiorario visti da fuori. */
  readonly facce: readonly (readonly number[])[];
  /** Normali uscenti, unitarie. */
  readonly normali: readonly V3[];
  /** Baricentri dei vertici di ogni faccia. */
  readonly centri: readonly V3[];
  /** Il numero che si legge quando questa è la faccia di lettura (d10: 0..9). */
  readonly letture: readonly number[];
  /** Vero per il d4: si legge la faccia rivolta in basso, e vale il vertice opposto. */
  readonly letturaInBasso: boolean;
  /** Solo d4: il numero di ogni vertice. */
  readonly valoriVertici?: readonly number[];
  /** Direzione, nel piano della faccia, verso cui punta la cima del numero. */
  readonly alto: readonly V3[];
  /** Somma delle facce opposte (d4: nessuna). */
  readonly sommaOpposte?: number;
  /** Raggio della sfera che contiene il dado. */
  readonly raggio: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const GRADI = Math.PI / 180;

// Misure in centimetri, vicine a quelle di un set comune.
export const MISURE = {
  d4Spigolo: 2.2,
  d6Spigolo: 1.6,
  d8Raggio: 1.05,
  d10Apice: 1.05,
  d10Anello: 1.0,
  d12Raggio: 1.15,
  d20Raggio: 1.2,
} as const;

/** Facce di un poliedro convesso: ogni piano che lascia tutti i vertici da una parte. */
function guscio(vertici: readonly V3[]): { facce: number[][]; normali: V3[] } {
  const n = vertici.length;
  const r = Math.max(...vertici.map(lunghezza));
  const eps = 1e-7 * r;
  const trovate = new Map<string, { vs: number[]; nrm: V3 }>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = vertici[i]!;
        const b = vertici[j]!;
        const c = vertici[k]!;
        const cr = vettoriale(diff(b, a), diff(c, a));
        const l = lunghezza(cr);
        if (l < eps * r) continue;
        let nrm = scala(cr, 1 / l);
        let d = punto(nrm, a);
        let sopra = 0;
        let sotto = 0;
        for (const v of vertici) {
          const s = punto(nrm, v) - d;
          if (s > eps) sopra++;
          else if (s < -eps) sotto++;
        }
        if (sopra > 0 && sotto > 0) continue;
        if (sopra > 0) {
          nrm = scala(nrm, -1);
          d = -d;
        }
        const chiave = nrm.map((x) => Math.round(x * 1e6)).join(',');
        if (trovate.has(chiave)) continue;
        const vs: number[] = [];
        vertici.forEach((v, idx) => {
          if (Math.abs(punto(nrm, v) - d) <= eps) vs.push(idx);
        });
        trovate.set(chiave, { vs, nrm });
      }
    }
  }
  const facce: number[][] = [];
  const normali: V3[] = [];
  for (const { vs, nrm } of trovate.values()) {
    const c = baricentro(vs.map((i) => vertici[i]!));
    const u = normalizza(diff(vertici[vs[0]!]!, c));
    const w = vettoriale(nrm, u);
    const angolo = (i: number) => {
      const p = diff(vertici[i]!, c);
      return Math.atan2(punto(p, w), punto(p, u));
    };
    facce.push([...vs].sort((a, b) => angolo(a) - angolo(b)));
    normali.push(nrm);
  }
  return { facce, normali };
}

function baricentro(punti: readonly V3[]): V3 {
  let s: V3 = [0, 0, 0];
  for (const p of punti) s = somma(s, p);
  return scala(s, 1 / punti.length);
}

/** Direzione nel piano della faccia, dal centro verso il punto p. */
function versoNelPiano(centro: V3, normale: V3, p: V3): V3 {
  const d = diff(p, centro);
  return normalizza(diff(d, scala(normale, punto(d, normale))));
}

const azimut = (v: V3) => Math.atan2(v[2], v[0]);
const stessaDirezione = (a: V3, b: V3) => punto(a, b) > 1 - 1e-9;

/** Indice della faccia con la normale opposta. */
function opposta(normali: readonly V3[], i: number): number {
  const n = normali[i]!;
  const j = normali.findIndex((m) => stessaDirezione(m, scala(n, -1)));
  if (j < 0) throw new Error('faccia senza opposta');
  return j;
}

/**
 * Una faccia per coppia di opposte, in ordine fisso: la «positiva» (prima componente non
 * nulla fra y, z, x maggiore di zero), dall'alto in basso e poi per azimut.
 */
function rappresentanti(normali: readonly V3[]): number[] {
  const positiva = (v: V3) => {
    for (const c of [v[1], v[2], v[0]]) {
      if (Math.abs(c) > 1e-9) return c > 0;
    }
    return false;
  };
  const scelti = normali.map((_, i) => i).filter((i) => positiva(normali[i]!));
  return scelti.sort((a, b) => {
    const na = normali[a]!;
    const nb = normali[b]!;
    if (Math.abs(na[1] - nb[1]) > 1e-9) return nb[1] - na[1];
    return azimut(na) - azimut(nb);
  });
}

/** Valori alle coppie: i primari ai rappresentanti, il complemento alle opposte. */
function valoriPerCoppie(normali: readonly V3[], primari: readonly number[], sommaOpposte: number): number[] {
  const rap = rappresentanti(normali);
  if (rap.length !== primari.length) throw new Error('coppie e primari non tornano');
  const valori = new Array<number>(normali.length).fill(Number.NaN);
  rap.forEach((i, k) => {
    valori[i] = primari[k]!;
    valori[opposta(normali, i)] = sommaOpposte - primari[k]!;
  });
  return valori;
}

function verticiD4(): V3[] {
  const s = MISURE.d4Spigolo / (2 * Math.SQRT2);
  return (
    [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ] as V3[]
  ).map((v) => scala(v, s));
}

function verticiD6(): V3[] {
  const s = MISURE.d6Spigolo / 2;
  const v: V3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x * s, y * s, z * s]);
  return v;
}

function verticiD8(): V3[] {
  const r = MISURE.d8Raggio;
  return [
    [r, 0, 0],
    [-r, 0, 0],
    [0, r, 0],
    [0, -r, 0],
    [0, 0, r],
    [0, 0, -r],
  ];
}

/**
 * Trapezoedro pentagonale: due apici sull'asse y e due anelli di cinque vertici sfalsati di 36°.
 * Perché ogni aquilone sia piano, l'altezza degli anelli è h = H (1 - cos 36°) / (1 + cos 36°).
 */
function verticiD10(): V3[] {
  const H = MISURE.d10Apice;
  const r = MISURE.d10Anello;
  const c = Math.cos(36 * GRADI);
  const h = (H * (1 - c)) / (1 + c);
  const v: V3[] = [
    [0, H, 0],
    [0, -H, 0],
  ];
  for (let k = 0; k < 5; k++) {
    const a = 72 * k * GRADI;
    v.push([r * Math.cos(a), h, r * Math.sin(a)]);
  }
  for (let k = 0; k < 5; k++) {
    const a = (72 * k + 36) * GRADI;
    v.push([r * Math.cos(a), -h, r * Math.sin(a)]);
  }
  return v;
}

function verticiD12(): V3[] {
  const s = MISURE.d12Raggio / Math.sqrt(3);
  const v: V3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      v.push([0, a / PHI, b * PHI]);
      v.push([a / PHI, b * PHI, 0]);
      v.push([b * PHI, 0, a / PHI]);
    }
  }
  return v.map((p) => scala(p, s));
}

function verticiD20(): V3[] {
  const s = MISURE.d20Raggio / Math.sqrt(1 + PHI * PHI);
  const v: V3[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      v.push([0, a, b * PHI]);
      v.push([a, b * PHI, 0]);
      v.push([b * PHI, 0, a]);
    }
  }
  return v.map((p) => scala(p, s));
}

function costruisci(forma: Forma): Geometria {
  const vertici =
    forma === 'd4'
      ? verticiD4()
      : forma === 'd6'
        ? verticiD6()
        : forma === 'd8'
          ? verticiD8()
          : forma === 'd10'
            ? verticiD10()
            : forma === 'd12'
              ? verticiD12()
              : verticiD20();
  const { facce, normali } = guscio(vertici);
  const centri = facce.map((f) => baricentro(f.map((i) => vertici[i]!)));
  const raggio = Math.max(...vertici.map(lunghezza));

  let letture: number[];
  let alto: V3[];
  let valoriVertici: number[] | undefined;
  let sommaOpposte: number | undefined;

  switch (forma) {
    case 'd4': {
      // Il vertice i vale i + 1; la faccia che non lo contiene, quando sta sotto, lo mostra in cima.
      valoriVertici = vertici.map((_, i) => i + 1);
      letture = facce.map((f) => {
        const fuori = vertici.findIndex((_, i) => !f.includes(i));
        return valoriVertici![fuori]!;
      });
      alto = facce.map((f, i) => versoNelPiano(centri[i]!, normali[i]!, vertici[f[0]!]!));
      break;
    }
    case 'd6': {
      // 1, 2, 3 attorno allo stesso vertice in senso antiorario, come nei dadi occidentali.
      const perAsse = (n: V3): number => {
        if (n[2] > 0.5) return 1;
        if (n[0] > 0.5) return 2;
        if (n[1] > 0.5) return 3;
        if (n[1] < -0.5) return 4;
        if (n[0] < -0.5) return 5;
        return 6;
      };
      letture = normali.map(perAsse);
      sommaOpposte = 7;
      alto = normali.map((n, i) =>
        Math.abs(n[1]) > 0.5
          ? versoNelPiano(centri[i]!, n, somma(centri[i]!, [0, 0, 1]))
          : versoNelPiano(centri[i]!, n, somma(centri[i]!, [0, 1, 0])),
      );
      break;
    }
    case 'd8': {
      // Dispari attorno al vertice alto, pari attorno al basso.
      letture = valoriPerCoppie(normali, [1, 7, 3, 5], 9);
      sommaOpposte = 9;
      alto = facce.map((f, i) => versoNelPiano(centri[i]!, normali[i]!, vertici[verticePiuAlto(vertici, f)]!));
      break;
    }
    case 'd10': {
      // Dispari attorno all'apice alto, pari attorno al basso; numeri 0..9, opposte a somma 9.
      letture = valoriPerCoppie(normali, [1, 7, 3, 9, 5], 9);
      sommaOpposte = 9;
      // La cima del numero guarda l'apice della propria metà, come nei d10 veri.
      alto = normali.map((n, i) => versoNelPiano(centri[i]!, n, n[1] > 0 ? vertici[0]! : vertici[1]!));
      break;
    }
    case 'd12': {
      letture = valoriPerCoppie(normali, [12, 2, 10, 4, 8, 6], 13);
      sommaOpposte = 13;
      alto = facce.map((f, i) => versoNelPiano(centri[i]!, normali[i]!, vertici[verticePiuAlto(vertici, f)]!));
      break;
    }
    case 'd20': {
      letture = valoriPerCoppie(normali, [20, 2, 18, 4, 16, 6, 14, 8, 12, 10], 21);
      sommaOpposte = 21;
      alto = facce.map((f, i) => versoNelPiano(centri[i]!, normali[i]!, vertici[verticePiuAlto(vertici, f)]!));
      break;
    }
  }

  return Object.freeze({
    forma,
    vertici,
    facce,
    normali,
    centri,
    letture,
    letturaInBasso: forma === 'd4',
    ...(valoriVertici ? { valoriVertici } : {}),
    alto,
    ...(sommaOpposte !== undefined ? { sommaOpposte } : {}),
    raggio,
  });
}

/** Vertice di una faccia scelto in modo fisso: il più alto in y, poi in z, poi in x. */
function verticePiuAlto(vertici: readonly V3[], faccia: readonly number[]): number {
  return [...faccia].sort((a, b) => {
    const va = vertici[a]!;
    const vb = vertici[b]!;
    for (const k of [1, 2, 0] as const) {
      if (Math.abs(va[k] - vb[k]) > 1e-9) return vb[k] - va[k];
    }
    return 0;
  })[0]!;
}

const CACHE = new Map<Forma, Geometria>();
export function geometria(forma: Forma): Geometria {
  let g = CACHE.get(forma);
  if (!g) {
    g = costruisci(forma);
    CACHE.set(forma, g);
  }
  return g;
}

/** Facce attese per ogni forma: un controllo sul guscio. */
export const NUMERO_FACCE: Record<Forma, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

/** Il valore del dado per una lettura: il d10 semplice vale 10 sullo 0, le decine vanno per dieci. */
export function valoreDaLettura(forma: Forma, ruolo: Ruolo, lettura: number): number {
  if (forma !== 'd10') return lettura;
  if (ruolo === 'decine') return lettura * 10;
  if (ruolo === 'unita') return lettura;
  return lettura === 0 ? 10 : lettura;
}

/** La scritta su una faccia (o su un vertice, per il d4). */
export function etichetta(forma: Forma, ruolo: Ruolo, lettura: number): string {
  if (forma === 'd10' && ruolo === 'decine') return lettura === 0 ? '00' : String(lettura * 10);
  return String(lettura);
}

/** 6 e 9 si sottolineano dove potrebbero confondersi: sulle scritte di una cifra sola. */
export function vaSottolineata(scritta: string): boolean {
  return scritta === '6' || scritta === '9';
}

/** Il d100 dalle due parti: 00 e 0 fanno 100. */
export function valoreD100(decine: number, unita: number): number {
  return decine === 0 && unita === 0 ? 100 : decine + unita;
}
