// La fonte del caso: crypto.getRandomValues, nel browser e in Node.
// Da qui vengono orientamento, posizione, velocità e rotazione di ogni lancio.

import { type Quat, type V3 } from '../shared/vettori.ts';

export interface Fonte {
  /** Un numero in [0, 1) con 53 bit di caso. */
  uniforme(): number;
}

/** Fonte vera, a blocchi da 1024 parole per non chiamare crypto a ogni numero. */
export function fonteCrypto(): Fonte {
  const blocco = new Uint32Array(1024);
  let i = blocco.length;
  const parola = () => {
    if (i >= blocco.length) {
      globalThis.crypto.getRandomValues(blocco);
      i = 0;
    }
    return blocco[i++]!;
  };
  return {
    uniforme() {
      // 26 + 27 bit, come Math.random dei motori moderni.
      const a = parola() >>> 6;
      const b = parola() >>> 5;
      return (a * 134217728 + b) / 9007199254740992;
    },
  };
}

/**
 * Fonte ripetibile (splitmix32), soltanto per le prove: lo stesso seme rifà lo stesso lancio.
 * I tiri veri usano fonteCrypto.
 */
export function fonteDaSeme(seme: number): Fonte {
  let s = seme >>> 0;
  const parola = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return {
    uniforme() {
      const a = parola() >>> 6;
      const b = parola() >>> 5;
      return (a * 134217728 + b) / 9007199254740992;
    },
  };
}

export const intervallo = (f: Fonte, min: number, max: number) => min + (max - min) * f.uniforme();

export function intero(f: Fonte, n: number): number {
  return Math.min(n - 1, Math.floor(f.uniforme() * n));
}

/** Quaternione uniforme sulla sfera delle rotazioni (Shoemake). */
export function quatUniforme(f: Fonte): Quat {
  const u1 = f.uniforme();
  const u2 = f.uniforme();
  const u3 = f.uniforme();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return {
    x: a * Math.sin(2 * Math.PI * u2),
    y: a * Math.cos(2 * Math.PI * u2),
    z: b * Math.sin(2 * Math.PI * u3),
    w: b * Math.cos(2 * Math.PI * u3),
  };
}

/** Direzione uniforme sulla sfera. */
export function direzioneUniforme(f: Fonte): V3 {
  const z = 2 * f.uniforme() - 1;
  const t = 2 * Math.PI * f.uniforme();
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

/** Mescola sul posto (Fisher-Yates). */
export function mescola<T>(f: Fonte, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = intero(f, i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
