// Le rotazioni che portano un dado su sé stesso. A ogni lancio una di queste, scelta a caso, lega i numeri
// al solido della fisica (vedi `giro` in physics/vassoio.ts): qualunque faccia il motore favorisca, per
// l'ordine in cui tratta vertici e pezzi del collisore, porta un numero tirato a sorte. Il gruppo porta
// ogni faccia su ogni altra lo stesso numero di volte, quindi ogni numero esce con la stessa probabilità,
// qualunque cosa faccia la fisica.

import { type Forma, geometria } from './dadi.ts';
import { type Quat, type V3, diff, lunghezza, normalizza, punto, scala, vettoriale } from './vettori.ts';

/** Il quaternione della rotazione che ha per colonne i tre vettori (una terna ortonormale destra). */
function quatDaTerna(a: V3, b: V3, c: V3): Quat {
  const [m00, m10, m20] = a;
  const [m01, m11, m21] = b;
  const [m02, m12, m22] = c;
  const traccia = m00 + m11 + m22;
  if (traccia > 0) {
    const s = 2 * Math.sqrt(traccia + 1);
    return { w: s / 4, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return { w: (m21 - m12) / s, x: s / 4, y: (m01 + m10) / s, z: (m02 + m20) / s };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: s / 4, z: (m12 + m21) / s };
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: s / 4 };
}

/** La terna ortonormale destra che ha il primo asse lungo a e il secondo nel piano di a e b. */
function terna(a: V3, b: V3): [V3, V3, V3] {
  const e1 = normalizza(a);
  const e2 = normalizza(diff(b, scala(e1, punto(b, e1))));
  return [e1, e2, vettoriale(e1, e2)];
}

function trova(forma: Forma): Quat[] {
  const v = geometria(forma).vertici;
  const scalaDado = Math.max(...v.map(lunghezza));
  const tol = 1e-6 * scalaDado;
  const a = v[0]!;
  const b = v.find((p) => lunghezza(vettoriale(a, p)) > 1e-3 * scalaDado * scalaDado)!;
  const [e1, e2, e3] = terna(a, b);
  const trovate: Quat[] = [];
  for (const c of v) {
    if (Math.abs(lunghezza(c) - lunghezza(a)) > tol) continue;
    for (const d of v) {
      if (Math.abs(lunghezza(d) - lunghezza(b)) > tol || Math.abs(punto(c, d) - punto(a, b)) > tol * scalaDado) continue;
      const [f1, f2, f3] = terna(c, d);
      // R = f1 e1ᵀ + f2 e2ᵀ + f3 e3ᵀ porta a su c e b su d; le sue colonne sono le immagini degli assi.
      const colonna = (k: 0 | 1 | 2): V3 => [
        f1[0] * e1[k] + f2[0] * e2[k] + f3[0] * e3[k],
        f1[1] * e1[k] + f2[1] * e2[k] + f3[1] * e3[k],
        f1[2] * e1[k] + f2[2] * e2[k] + f3[2] * e3[k],
      ];
      const [c0, c1, c2] = [colonna(0), colonna(1), colonna(2)];
      const porta = (p: V3): V3 => [c0[0] * p[0] + c1[0] * p[1] + c2[0] * p[2], c0[1] * p[0] + c1[1] * p[1] + c2[1] * p[2], c0[2] * p[0] + c1[2] * p[1] + c2[2] * p[2]];
      // È una simmetria se ogni vertice finisce su un vertice.
      if (!v.every((p) => v.some((u) => lunghezza(diff(porta(p), u)) < tol * 10))) continue;
      const q = quatDaTerna(c0, c1, c2);
      if (trovate.some((t) => Math.abs(t.w * q.w + t.x * q.x + t.y * q.y + t.z * q.z) > 1 - 1e-9)) continue;
      trovate.push(q);
    }
  }
  return trovate;
}

const perForma = new Map<Forma, readonly Quat[]>();

/** Tutte le rotazioni che portano il solido su sé stesso: 12 per il d4, 24 per d6 e d8, 10 per il d10, 60 per d12 e d20. */
export function rotazioniDelSolido(forma: Forma): readonly Quat[] {
  let r = perForma.get(forma);
  if (!r) {
    r = trova(forma);
    perForma.set(forma, r);
  }
  return r;
}
