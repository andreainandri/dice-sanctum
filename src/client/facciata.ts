// La veste della torre: le geometrie della facciata intagliata, dall'architrave sopra l'arco alla cornice
// di cima, con la targa dove si legge il totale. È soltanto disegno, appoggiato alle misure della fisica:
// niente di quello che sta qui tocca i dadi.

import * as THREE from 'three';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { type MisureTorre } from '../physics/torre.ts';

/** Un punto di un profilo: quanto sporge e a che quota. */
type P2 = readonly [sporge: number, quota: number];
/** Un profilo è fatto di tratti: dentro un tratto la superficie è liscia, fra un tratto e l'altro c'è uno spigolo. */
type Profilo = readonly (readonly P2[])[];

/** Un quarto di tondo fra due punti, di centro dato: `passi` segmenti. */
function quarto(centro: P2, da: P2, a: P2, passi = 6): P2[] {
  const a0 = Math.atan2(da[1] - centro[1], da[0] - centro[0]);
  let a1 = Math.atan2(a[1] - centro[1], a[0] - centro[0]);
  if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
  if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
  const r = Math.hypot(da[0] - centro[0], da[1] - centro[1]);
  return Array.from({ length: passi + 1 }, (_, i): P2 => {
    const t = a0 + ((a1 - a0) * i) / passi;
    return [centro[0] + r * Math.cos(t), centro[1] + r * Math.sin(t)];
  });
}

/**
 * Una modanatura: il profilo portato lungo un percorso a spigoli vivi nel piano orizzontale, tagliato a
 * 45 gradi negli angoli come le cornici dei falegnami. Il percorso è una spezzata di punti (x, z), chiusa o
 * aperta, anche con rientranze; il profilo sporge verso fuori e sale in quota. Fuori è la destra di chi
 * percorre un giro chiuso tenendo il legno dentro, oppure, per un tratto aperto, la parte opposta a `dentro`.
 * Chi percorre il profilo ha il legno alla sua sinistra. La trama corre lungo il percorso, in centimetri.
 */
function modanatura(percorso: readonly (readonly [number, number])[], chiuso: boolean, dentro: readonly [number, number] | null, profilo: Profilo): THREE.BufferGeometry {
  const n = percorso.length;
  const lati = chiuso ? n : n - 1;
  // Il senso del giro: l'area con segno dice da che parte sta il dentro.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = percorso[i]!;
    const b = percorso[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  // La normale di ogni lato, verso fuori.
  const normali: [number, number][] = [];
  for (let i = 0; i < lati; i++) {
    const a = percorso[i]!;
    const b = percorso[(i + 1) % n]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = (b[1] - a[1]) / l;
    let nz = -(b[0] - a[0]) / l;
    const gira = dentro ? nx * ((a[0] + b[0]) / 2 - dentro[0]) + nz * ((a[1] + b[1]) / 2 - dentro[1]) < 0 : area < 0;
    if (gira) {
      nx = -nx;
      nz = -nz;
    }
    normali.push([nx, nz]);
  }
  // La direzione del taglio in ogni vertice: lungo di lei i due lati sporgono della stessa misura.
  const taglio = (i: number): [number, number] => {
    const prima = chiuso ? normali[(i - 1 + lati) % lati]! : i > 0 ? normali[i - 1]! : normali[0]!;
    const dopo = chiuso ? normali[i % lati]! : i < lati ? normali[i]! : normali[lati - 1]!;
    const k = 1 + prima[0] * dopo[0] + prima[1] * dopo[1];
    return [(prima[0] + dopo[0]) / k, (prima[1] + dopo[1]) / k];
  };
  const pos: number[] = [];
  const uv: number[] = [];
  const indici: number[] = [];
  for (let i = 0; i < lati; i++) {
    const a = percorso[i]!;
    const b = percorso[(i + 1) % n]!;
    const ta = taglio(i);
    const tb = taglio((i + 1) % (chiuso ? n : n + 1));
    const lungo = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [nx, nz] = normali[i]!;
    let traverso = 0;
    for (const tratto of profilo) {
      const base = pos.length / 3;
      tratto.forEach((p, k) => {
        if (k > 0) traverso += Math.hypot(p[0] - tratto[k - 1]![0], p[1] - tratto[k - 1]![1]);
        pos.push(a[0] + ta[0] * p[0], p[1], a[1] + ta[1] * p[0]);
        pos.push(b[0] + tb[0] * p[0], p[1], b[1] + tb[1] * p[0]);
        uv.push(0, traverso, lungo, traverso);
      });
      for (let k = 0; k + 1 < tratto.length; k++) {
        const [a0, b0, a1, b1] = [base + 2 * k, base + 2 * k + 1, base + 2 * k + 2, base + 2 * k + 3];
        // La faccia guarda a destra di chi percorre il profilo: fuori dal legno.
        const ds = tratto[k + 1]![0] - tratto[k]![0];
        const dq = tratto[k + 1]![1] - tratto[k]![1];
        const voluta = new THREE.Vector3(dq * nx, -ds, dq * nz);
        const u = new THREE.Vector3(pos[b0 * 3]! - pos[a0 * 3]!, pos[b0 * 3 + 1]! - pos[a0 * 3 + 1]!, pos[b0 * 3 + 2]! - pos[a0 * 3 + 2]!);
        const w = new THREE.Vector3(pos[a1 * 3]! - pos[a0 * 3]!, pos[a1 * 3 + 1]! - pos[a0 * 3 + 1]!, pos[a1 * 3 + 2]! - pos[a0 * 3 + 2]!);
        if (u.cross(w).dot(voluta) >= 0) indici.push(a0, b0, a1, a1, b0, b1);
        else indici.push(a0, a1, b0, b0, a1, b1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indici);
  g.computeVertexNormals();
  return g;
}

/** Trama in centimetri per i pezzi estrusi da una sagoma: la venatura sale in verticale, sul davanti e sui fianchi. */
const VENATURA_IN_PIEDI: THREE.UVGenerator = {
  generateTopUV(_g, v, a, b, c) {
    return [a, b, c].map((i) => new THREE.Vector2(v[i * 3 + 1]!, v[i * 3]!));
  },
  generateSideWallUV(_g, v, a, b, c, d) {
    return [a, b, c, d].map((i) => new THREE.Vector2(v[i * 3 + 1]!, v[i * 3 + 2]!));
  },
};

/** Porta sul piano della facciata una geometria costruita in piano: la sua altezza diventa lo sporgere verso chi guarda. */
function sullaFacciata(g: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Un rettangolo come percorso chiuso, centrato nell'origine del piano. */
const rettangolo = (mezzaL: number, mezzaA: number): [number, number][] => [
  [-mezzaL, -mezzaA],
  [mezzaL, -mezzaA],
  [mezzaL, mezzaA],
  [-mezzaL, mezzaA],
];

/** Le misure della veste, in centimetri, dal piano della corte. */
export const FACCIATA = {
  /** L'architrave sopra l'arco: quanto è alto e quanto sporge. */
  architrave: { alto: 0.95, sporge: 0.5 },
  /** La targa del totale: dove comincia sopra l'arco, quanto è alta, quanto resta dai fianchi. */
  targa: { sopraLArco: 1.6, alta: 4.2, margine: 2.4, cornice: 0.6, rilievo: 0.3 },
  /** Il marcapiano sopra la targa. */
  marcapiano: { sopraLaTarga: 0.4, alto: 1.4, sporge: 1.15 },
  /** I pennacchi che arrotondano gli angoli in alto dell'arco: il loro raggio. */
  pennacchio: 1.3,
  /** La cornice di cima, intorno alla bocca. */
  cima: { alta: 1.8, sporge: 1.5 },
  /** Le mensole ai fianchi della torre, dalla cornice del vassoio al marcapiano: quanto si allargano in cima e quanto sono profonde. */
  mensola: { larga: 1.8, profonda: 2.6 },
} as const;

/** Il campo della targa, dove si scrive il totale: centro, larghezza e altezza, sul piano della facciata. */
export function campoDellaTarga(t: MisureTorre): { x: number; y: number; z: number; largo: number; alto: number } {
  const T = FACCIATA.targa;
  return { x: 0, y: t.arco + T.sopraLArco + T.alta / 2, z: t.z2, largo: t.x1 - t.x0 - 2 * T.margine, alto: T.alta };
}

/** A che quota finisce il marcapiano: da lì in su comincia il piano di sopra della torre. */
export function quotaMarcapiano(t: MisureTorre): { da: number; a: number } {
  const da = t.arco + FACCIATA.targa.sopraLArco + FACCIATA.targa.alta + FACCIATA.targa.cornice + FACCIATA.marcapiano.sopraLaTarga;
  return { da, a: da + FACCIATA.marcapiano.alto };
}

/**
 * Fin dove la facciata deve stare nel riquadro quando la torre non ci sta tutta: la targa intera e l'inizio
 * del marcapiano, che il bordo della tela taglia.
 */
export function quotaDiTaglio(t: MisureTorre): number {
  return quotaMarcapiano(t).da + 1.25;
}

export interface PezzoDiFacciata {
  geometria: THREE.BufferGeometry;
  /** `noce` è il legno della torre, `campo` il fondo scuro delle targhe, `ottone` i filetti. */
  materiale: 'noce' | 'campo' | 'ottone';
}

/**
 * Tutti i pezzi della veste: architrave, targa con la sua cornice e il filetto d'ottone, marcapiano,
 * pannello del piano di sopra, cornice di cima e le due mensole. `parete` è lo spessore dei muri della torre.
 */
export function pezziDellaFacciata(t: MisureTorre, parete: number, base: number): PezzoDiFacciata[] {
  const F = FACCIATA;
  const pezzi: PezzoDiFacciata[] = [];
  const mezza = (t.x1 - t.x0) / 2 + parete;
  const zf = t.z2;
  const zd = t.z0 - parete;
  const centro: [number, number] = [0, (zf + zd) / 2];
  const giro: [number, number][] = [
    [-mezza, zf],
    [mezza, zf],
    [mezza, zd],
    [-mezza, zd],
  ];
  // Il marcapiano gira anche intorno alle mensole, che allargano la torre sul davanti.
  const conMensole = mezza + F.mensola.larga;
  const dietroLeMensole = zf - F.mensola.profonda;
  const giroLargo: [number, number][] = [
    [-conMensole, zf],
    [conMensole, zf],
    [conMensole, dietroLeMensole],
    [mezza, dietroLeMensole],
    [mezza, zd],
    [-mezza, zd],
    [-mezza, dietroLeMensole],
    [-conMensole, dietroLeMensole],
  ];

  // L'architrave: una fascia e un tondo, soltanto davanti.
  {
    const y = t.arco;
    const { alto, sporge } = F.architrave;
    const r = 0.3;
    pezzi.push({
      materiale: 'noce',
      geometria: modanatura(
        [
          [-mezza, zf],
          [mezza, zf],
        ],
        false,
        centro,
        [
          [
            [0, y],
            [sporge, y],
          ],
          [
            [sporge, y],
            [sporge, y + alto - r],
          ],
          quarto([sporge - r, y + alto - r], [sporge, y + alto - r], [sporge - r, y + alto]),
          [
            [sporge - r, y + alto],
            [0, y + alto],
          ],
        ],
      ),
    });
  }

  // I pennacchi: due quarti di tondo negli angoli in alto dell'arco, a filo dell'architrave.
  {
    const r = F.pennacchio;
    for (const lato of [-1, 1]) {
      const x = lato * (t.x1 - t.x0) * 0.5;
      const forma = new THREE.Shape();
      forma.moveTo(x, t.arco);
      forma.lineTo(x - lato * r, t.arco);
      forma.absarc(x - lato * r, t.arco - r, r, Math.PI / 2, lato > 0 ? 0 : Math.PI, lato > 0);
      forma.closePath();
      const estrusa = new THREE.ExtrudeGeometry(forma, { depth: zf - t.z1 + F.architrave.sporge, bevelEnabled: false, curveSegments: 12, UVGenerator: VENATURA_IN_PIEDI });
      const g = toCreasedNormals(estrusa, Math.PI / 5);
      estrusa.dispose();
      g.translate(0, 0, t.z1);
      pezzi.push({ materiale: 'noce', geometria: g });
    }
  }

  // La targa: il campo scuro, la cornice a rilievo intorno, il filetto d'ottone dentro la cornice.
  const campo = campoDellaTarga(t);
  const incornicia = (cx: number, cy: number, largo: number, alto: number, cornice: number, rilievo: number) => {
    const piano = new THREE.PlaneGeometry(largo, alto);
    const uv = piano.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * largo, (uv.getY(i) - 0.5) * alto);
    piano.translate(cx, cy, zf + 0.02);
    pezzi.push({ materiale: 'campo', geometria: piano });
    const r = rilievo * 0.55;
    // Da fuori verso il campo: tondo che sale, cima piana, smusso che scende.
    pezzi.push({
      materiale: 'noce',
      geometria: sullaFacciata(
        modanatura(rettangolo(largo / 2, alto / 2), true, null, [
          quarto([cornice - r, rilievo - r], [cornice, rilievo - r], [cornice - r, rilievo]),
          [
            [cornice - r, rilievo],
            [cornice * 0.42, rilievo],
          ],
          [
            [cornice * 0.42, rilievo],
            [0, 0.02],
          ],
        ]),
        cx,
        cy,
        zf,
      ),
    });
    pezzi.push({
      materiale: 'noce',
      geometria: sullaFacciata(
        modanatura(rettangolo(largo / 2, alto / 2), true, null, [
          [
            [cornice, 0],
            [cornice, rilievo - r],
          ],
        ]),
        cx,
        cy,
        zf,
      ),
    });
    const dentro = 0.34;
    pezzi.push({
      materiale: 'ottone',
      geometria: sullaFacciata(
        modanatura(rettangolo(largo / 2 - dentro, alto / 2 - dentro), true, null, [
          [
            [0.09, 0.02],
            [0.09, 0.07],
          ],
          [
            [0.09, 0.07],
            [0, 0.07],
          ],
          [
            [0, 0.07],
            [0, 0.02],
          ],
        ]),
        cx,
        cy,
        zf,
      ),
    });
  };
  incornicia(campo.x, campo.y, campo.largo, campo.alto, F.targa.cornice, F.targa.rilievo);

  // Il marcapiano e la cornice di cima girano intorno alla torre: gola, listello e fascia.
  const cornicione = (da: number, alto: number, sporge: number): Profilo => {
    const listello = Math.min(0.22, sporge * 0.2);
    const fascia = alto * 0.34;
    const gola = Math.min(sporge - 2 * listello, alto - fascia - listello);
    return [
      [
        [0, da],
        [listello, da],
      ],
      [
        [listello, da],
        [listello, da + listello],
      ],
      quarto([listello + gola, da + listello], [listello, da + listello], [listello + gola, da + listello + gola], 8),
      [
        [listello + gola, da + listello + gola],
        [sporge, da + listello + gola],
      ],
      [
        [sporge, da + listello + gola],
        [sporge, da + alto],
      ],
      [
        [sporge, da + alto],
        [0, da + alto],
      ],
    ];
  };
  const m = quotaMarcapiano(t);
  pezzi.push({ materiale: 'noce', geometria: modanatura(giroLargo, true, null, cornicione(m.da, F.marcapiano.alto, F.marcapiano.sporge)) });
  pezzi.push({ materiale: 'noce', geometria: modanatura(giro, true, null, cornicione(t.alta - F.cima.alta, F.cima.alta, F.cima.sporge)) });

  // Il pannello del piano di sopra, se fra marcapiano e cima c'è posto.
  const sotto = m.a + 1.3;
  const sopra = t.alta - F.cima.alta - 1.3;
  if (sopra - sotto > 3) incornicia(0, (sotto + sopra) / 2, campo.largo, sopra - sotto, F.targa.cornice * 0.8, F.targa.rilievo * 0.8);

  // Le mensole: due fianchi sagomati che allargano la torre salendo, col piede sulla cornice del vassoio e
  // la testa sotto il marcapiano. La sagoma sta nel piano della facciata, a filo con lei.
  {
    const { larga, profonda } = F.mensola;
    const smusso = 0.1;
    const y0 = base;
    const y1 = m.da;
    for (const lato of [-1, 1]) {
      const x = (fuori: number) => lato * (mezza + fuori);
      const forma = new THREE.Shape();
      forma.moveTo(x(-0.2), y0);
      forma.lineTo(x(0.85), y0);
      forma.bezierCurveTo(x(1.3), y0 + 0.5, x(1.2), y0 + 1.5, x(0.75), y0 + 2.2);
      forma.bezierCurveTo(x(0.4), y0 + 3.2, x(0.45), y1 - 3.6, x(1.0), y1 - 2.1);
      forma.bezierCurveTo(x(1.35), y1 - 1.3, x(larga), y1 - 1.2, x(larga), y1 - 0.25);
      forma.lineTo(x(larga), y1);
      forma.lineTo(x(-0.2), y1);
      forma.closePath();
      const estrusa = new THREE.ExtrudeGeometry(forma, { depth: profonda - 2 * smusso, bevelEnabled: true, bevelThickness: smusso, bevelSize: smusso, bevelOffset: -smusso, bevelSegments: 2, curveSegments: 24, UVGenerator: VENATURA_IN_PIEDI });
      // Le curve della sagoma sono a tratti: le normali si lisciano, tranne che sugli spigoli veri.
      const g = toCreasedNormals(estrusa, Math.PI / 5);
      estrusa.dispose();
      g.translate(0, 0, zf - profonda + smusso);
      pezzi.push({ materiale: 'noce', geometria: g });
    }
  }
  return pezzi;
}
