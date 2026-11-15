// Vettori e quaternioni minimi, senza dipendenze: li usano geometrie, lettore e fisica,
// sia nel browser sia in Node. I quaternioni hanno la forma {x, y, z, w} di Rapier.

export type V3 = readonly [number, number, number];
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const somma = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const diff = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scala = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const punto = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vettoriale = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lunghezza = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export function normalizza(a: V3): V3 {
  const l = lunghezza(a);
  if (l === 0) throw new Error('normalizza: vettore nullo');
  return [a[0] / l, a[1] / l, a[2] / l];
}

export const QUAT_IDENTITA: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** Ruota il vettore v col quaternione q (unitario). */
export function ruota(q: Quat, v: V3): V3 {
  // v' = v + 2w (u × v) + 2 u × (u × v), con u = (x, y, z)
  const u: V3 = [q.x, q.y, q.z];
  const t = scala(vettoriale(u, v), 2);
  return somma(somma(v, scala(t, q.w)), vettoriale(u, t));
}

export function prodotto(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function quatDaAsseAngolo(asse: V3, angolo: number): Quat {
  const n = normalizza(asse);
  const s = Math.sin(angolo / 2);
  return { x: n[0] * s, y: n[1] * s, z: n[2] * s, w: Math.cos(angolo / 2) };
}

/** Il quaternione più corto che porta la direzione a sulla direzione b. */
export function quatDaA(a: V3, b: V3): Quat {
  const na = normalizza(a);
  const nb = normalizza(b);
  const c = punto(na, nb);
  if (c < -1 + 1e-12) {
    // Direzioni opposte: mezzo giro attorno a un asse qualsiasi perpendicolare ad a.
    const prova: V3 = Math.abs(na[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return quatDaAsseAngolo(vettoriale(na, prova), Math.PI);
  }
  const ax = vettoriale(na, nb);
  const q = { x: ax[0], y: ax[1], z: ax[2], w: 1 + c };
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

export function normaQuat(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}
