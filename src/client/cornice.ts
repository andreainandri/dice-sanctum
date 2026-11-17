// La cornice del vassoio: un profilo (sponda di fuori, spigolo tondo, cima, spigolo tondo, sponda di dentro)
// portato in giro lungo il bordo. È soltanto disegno: le sponde della fisica sono piani alti fino al
// coperchio. La cima è bassa tutto in giro, perché la sponda dalla parte di chi guarda non nasconda i dadi
// fermi contro di lei; sul lato di fondo ci sta sopra la torre.

import * as THREE from 'three';

export interface MisureCornice {
  /** Il vano interno, in centimetri. */
  larghezza: number;
  profondita: number;
  /** Lo spessore delle sponde e l'altezza della loro cima sul fondo. */
  spessore: number;
  sponda: number;
  /** Raggio degli angoli dentro e fuori, visti dall'alto. */
  angoloDentro: number;
  angoloFuori: number;
  /** Il raggio degli spigoli tondi in cima. */
  smusso: number;
  /** Quanto la cornice scende sotto il fondo, fino al tavolo. */
  base: number;
}

const PASSO_LATO = 0.5;
const PASSI_ANGOLO = 8;
const PASSI_SMUSSO = 4;

/** Una stazione del giro: un raggio che parte dentro il vano e taglia tutti i contorni della cornice. */
interface Stazione {
  /** Origine e direzione nel primo quadrante; i segni riportano il punto nel suo. */
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  sx: number;
  sz: number;
}

interface Punto {
  x: number;
  z: number;
  /** La normale del contorno, verso fuori dal vassoio. */
  nx: number;
  nz: number;
}

/**
 * Le stazioni in giro al vano, a partire dal fondo della sponda di destra: sui lati dritti una ogni mezzo
 * centimetro, alle stesse coordinate per tutti i contorni; negli angoli a ventaglio dal centro dell'arco di dentro.
 */
function stazioni(m: MisureCornice): Stazione[] {
  const cx = m.larghezza / 2 - m.angoloDentro;
  const cz = m.profondita / 2 - m.angoloDentro;
  const giro: Stazione[] = [];
  const lato = (lungo: number, fai: (t: number) => Stazione) => {
    const n = Math.max(1, Math.ceil((2 * lungo) / PASSO_LATO));
    for (let i = 0; i <= n; i++) giro.push(fai(-lungo + (2 * lungo * i) / n));
  };
  const angolo = (sx: number, sz: number, daX: boolean) => {
    for (let i = 1; i < PASSI_ANGOLO; i++) {
      const a = ((daX ? i : PASSI_ANGOLO - i) / PASSI_ANGOLO) * (Math.PI / 2);
      giro.push({ x0: cx, z0: cz, dx: Math.cos(a), dz: Math.sin(a), sx, sz });
    }
  };
  const segno = (v: number) => (v < 0 ? -1 : 1);
  lato(cz, (z) => ({ x0: cx, z0: Math.abs(z), dx: 1, dz: 0, sx: 1, sz: segno(z) }));
  angolo(1, 1, true);
  lato(cx, (x) => ({ x0: Math.abs(x), z0: cz, dx: 0, dz: 1, sx: segno(-x), sz: 1 }));
  angolo(-1, 1, false);
  lato(cz, (z) => ({ x0: cx, z0: Math.abs(z), dx: 1, dz: 0, sx: -1, sz: segno(-z) }));
  angolo(-1, -1, true);
  lato(cx, (x) => ({ x0: Math.abs(x), z0: cz, dx: 0, dz: 1, sx: segno(x), sz: -1 }));
  angolo(1, -1, false);
  return giro;
}

/** Dove il raggio della stazione taglia un rettangolo dagli angoli tondi (mezze misure e raggio). */
function taglia(s: Stazione, mezzaL: number, mezzaP: number, raggio: number): Punto {
  const ax = mezzaL - raggio;
  const az = mezzaP - raggio;
  let p: Punto | null = null;
  if (s.dx > 1e-9) {
    const z = s.z0 + ((mezzaL - s.x0) / s.dx) * s.dz;
    if (z <= az + 1e-9) p = { x: mezzaL, z, nx: 1, nz: 0 };
  }
  if (!p && s.dz > 1e-9) {
    const x = s.x0 + ((mezzaP - s.z0) / s.dz) * s.dx;
    if (x <= ax + 1e-9) p = { x, z: mezzaP, nx: 0, nz: 1 };
  }
  if (!p) {
    const fx = s.x0 - ax;
    const fz = s.z0 - az;
    const b = fx * s.dx + fz * s.dz;
    const t = -b + Math.sqrt(Math.max(0, b * b - (fx * fx + fz * fz - raggio * raggio)));
    const x = s.x0 + t * s.dx;
    const z = s.z0 + t * s.dz;
    p = { x, z, nx: (x - ax) / raggio, nz: (z - az) / raggio };
  }
  return { x: p.x * s.sx, z: p.z * s.sz, nx: p.nx * s.sx, nz: p.nz * s.sz };
}

/** Un vertice del profilo: dove sta in pianta e a che altezza. */
type Vertice = [x: number, y: number, z: number];

/**
 * Porta in giro un profilo lungo le stazioni e ne fa una superficie chiusa su sé stessa. La trama corre lungo
 * il giro (in centimetri) e sale lungo il profilo, come un listello piegato.
 */
function superficie(giro: readonly Stazione[], profilo: (s: Stazione) => Vertice[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const indici: number[] = [];
  let lungo = 0;
  let prima: Vertice[] | null = null;
  let perStazione = 0;
  // La prima stazione si ripete in fondo: lì la trama ha il suo capo.
  for (let i = 0; i <= giro.length; i++) {
    const v = profilo(giro[i % giro.length]!);
    perStazione = v.length;
    if (prima) {
      // Il passo del giro si misura a metà del profilo, dove sta la cima.
      const a = prima[Math.floor(v.length / 2)]!;
      const b = v[Math.floor(v.length / 2)]!;
      lungo += Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
    let traverso = 0;
    v.forEach((p, j) => {
      if (j > 0) traverso += Math.hypot(p[0] - v[j - 1]![0], p[1] - v[j - 1]![1], p[2] - v[j - 1]![2]);
      pos.push(p[0], p[1], p[2]);
      uv.push(lungo, traverso);
    });
    prima = v;
  }
  for (let i = 0; i < giro.length; i++) {
    for (let j = 0; j < perStazione - 1; j++) {
      const a = i * perStazione + j;
      const b = (i + 1) * perStazione + j;
      indici.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indici);
  g.computeVertexNormals();
  // Dove il giro si chiude i vertici sono doppi: prendono la stessa normale, e la giunta non si vede.
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let j = 0; j < perStazione; j++) {
    const ultimo = giro.length * perStazione + j;
    const x = n.getX(j) + n.getX(ultimo);
    const y = n.getY(j) + n.getY(ultimo);
    const z = n.getZ(j) + n.getZ(ultimo);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(j, x / l, y / l, z / l);
    n.setXYZ(ultimo, x / l, y / l, z / l);
  }
  g.computeBoundingSphere();
  return g;
}

/** La cornice di legno, dal tavolo alla cima e giù fino al fondo del vano. */
export function geometriaCornice(m: MisureCornice): THREE.BufferGeometry {
  const s = m.smusso;
  return superficie(stazioni(m), (st) => {
    const fuori = taglia(st, m.larghezza / 2 + m.spessore, m.profondita / 2 + m.spessore, m.angoloFuori);
    const dentro = taglia(st, m.larghezza / 2, m.profondita / 2, m.angoloDentro);
    const v: Vertice[] = [[fuori.x, -m.base, fuori.z]];
    // Lo spigolo tondo di fuori: dalla sponda alla cima, rientrando verso il vano.
    for (let a = 0; a <= PASSI_SMUSSO; a++) {
      const t = (a / PASSI_SMUSSO) * (Math.PI / 2);
      const x = fuori.x - fuori.nx * s * (1 - Math.cos(t));
      const z = fuori.z - fuori.nz * s * (1 - Math.cos(t));
      v.push([x, m.sponda - s + s * Math.sin(t), z]);
    }
    // Quello di dentro: dalla cima giù alla sponda del vano.
    for (let a = PASSI_SMUSSO; a >= 0; a--) {
      const t = (a / PASSI_SMUSSO) * (Math.PI / 2);
      const x = dentro.x + dentro.nx * s * (1 - Math.cos(t));
      const z = dentro.z + dentro.nz * s * (1 - Math.cos(t));
      v.push([x, m.sponda - s + s * Math.sin(t), z]);
    }
    // Un filo sotto il fondo: fra sponda e fodera non resta una fessura.
    v.push([dentro.x, -0.05, dentro.z]);
    return v;
  });
}

/** Il filo d'ottone intarsiato nella cima: segue la sponda, a `distanza` dal bordo di dentro, largo `largo`. */
export function geometriaFilo(m: MisureCornice, distanza: number, largo: number): THREE.BufferGeometry {
  /** Quanto sporge dal legno e quanto ci affonda. */
  const sopra = 0.02;
  const sotto = 0.04;
  return superficie(stazioni(m), (st) => {
    const a = taglia(st, m.larghezza / 2 + distanza + largo, m.profondita / 2 + distanza + largo, m.angoloDentro + distanza + largo);
    const b = taglia(st, m.larghezza / 2 + distanza, m.profondita / 2 + distanza, m.angoloDentro + distanza);
    return [
      [a.x, m.sponda - sotto, a.z],
      [a.x, m.sponda + sopra, a.z],
      [b.x, m.sponda + sopra, b.z],
      [b.x, m.sponda - sotto, b.z],
    ];
  });
}
