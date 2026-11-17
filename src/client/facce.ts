// Le mesh dei dadi e le loro facce dipinte, in tre serie. Due sono di chi gioca, da scegliere: Perla azzurra
// (resina azzurra a nuvole, numeri d'argento) e Ossidiana e oro (corpo nero lucido, numeri d'oro incisi).
// La terza è del master: sangue di bue marmorizzato coi numeri d'oro, che a colpo d'occhio non si confonde.
// La mesh nasce dagli stessi vertici del collisore e del lettore; gli spigoli smussati sono soltanto disegno
// e stanno dentro il guscio, con ogni faccia sul piano della faccia del collisore: un dado posato tocca il
// fondo dove lo tocca la fisica. I numeri si dipingono su tele (una cella per faccia) dalla stessa tabella
// `letture` che il lettore usa, con la cima del numero verso `alto`. Geometrie e materiali sono condivisi
// fra tutti i dadi uguali.

import * as THREE from 'three';
import { type Forma, type Ruolo, etichetta, geometria, vaSottolineata } from '../shared/dadi.ts';
import { type V3, diff, lunghezza, normalizza, punto, scala, somma, vettoriale } from '../shared/vettori.ts';

export const TONI = ['normale', 'scartato', 'oro', 'rosso'] as const;
export type Tono = (typeof TONI)[number];
/** Le serie fra cui sceglie chi gioca al tavolo; la prima è quella di partenza. */
export const SERIE_DEL_GIOCATORE = ['perla', 'ossidiana'] as const;
export type SerieDelGiocatore = (typeof SERIE_DEL_GIOCATORE)[number];
/** Tutte le serie: quelle di chi gioca e quella del master. */
export const SERIE = [...SERIE_DEL_GIOCATORE, 'master'] as const;
export type Serie = (typeof SERIE)[number];

const CELLA = 256;
const MARGINE = 8;
/** Le tele dei dati (rilievo, ruvidezza, metallo) e della luce dei numeri, in frazione della tela del colore. */
const SCALA_DATI = 0.5;
/**
 * Colore di corpo e numeri, e i loro valori sulla tela dei dati: rosso il rilievo (il corpo in alto, i
 * numeri incisi), verde la ruvidezza, blu il metallo.
 */
interface Aspetto {
  /** Il colore del corpo; se la resina ha le vene, è quello degli spigoli. */
  corpo: string;
  numeri: string;
  datiCorpo: string;
  datiNumeri: string;
  /** Le vene della resina, quando il corpo non è di un colore solo. */
  vene?: Vene;
  /** Un filo scuro intorno alle cifre, dove il corpo chiaro le confonderebbe. */
  contorno?: string;
}

/**
 * Una resina a due colori che si mescolano a nuvole (`scuro` e `chiaro`), con una vena sottile di un terzo
 * colore dove le nuvole si incontrano: `forza` dice quanto la vena copre, `fitte` quante nuvole stanno in un
 * centimetro.
 */
interface Vene {
  scuro: string;
  chiaro: string;
  vena: string;
  forza: number;
  fitte: number;
}

/** Perla azzurra: resina azzurra a nuvole con striature di perla, numeri d'argento. */
const PERLA: Aspetto = {
  corpo: '#3a82c2',
  numeri: '#eef2f6',
  datiCorpo: 'rgb(255, 52, 56)',
  datiNumeri: 'rgb(70, 84, 140)',
  contorno: '#123961',
  vene: { scuro: '#2a6aab', chiaro: '#4b96d6', vena: '#bfe0f7', forza: 0.5, fitte: 0.85 },
};
/** Il d10 delle decine della perla: blu notte, più scuro del compagno del d100. */
const NOTTE: Aspetto = {
  corpo: '#142c4e',
  numeri: '#eef2f6',
  datiCorpo: 'rgb(255, 52, 56)',
  datiNumeri: 'rgb(70, 84, 140)',
  vene: { scuro: '#0a1830', chiaro: '#234a7c', vena: '#7fb2e0', forza: 0.5, fitte: 0.85 },
};
/** Ossidiana: resina nera lucida, numeri d'oro. */
const OSSIDIANA: Aspetto = { corpo: '#0d0c0f', numeri: '#caa252', datiCorpo: 'rgb(255, 38, 0)', datiNumeri: 'rgb(70, 90, 255)' };
/** Bronzo brunito coi numeri neri: il d10 delle decine si distingue dal compagno del d100 su qualunque fondo. */
const BRONZO: Aspetto = { corpo: '#7a5a38', numeri: '#121014', datiCorpo: 'rgb(255, 105, 140)', datiNumeri: 'rgb(70, 115, 0)' };
/** I dadi del master: sangue di bue marmorizzato, con le vene quasi nere e i numeri d'oro. */
const SANGUE: Aspetto = {
  corpo: '#5c0f17',
  numeri: '#efcf80',
  datiCorpo: 'rgb(255, 38, 0)',
  datiNumeri: 'rgb(70, 90, 255)',
  vene: { scuro: '#35060b', chiaro: '#8a1722', vena: '#120204', forza: 0.85, fitte: 0.9 },
};
/** Il d10 delle decine del master, più scuro del compagno e coi numeri color osso. */
const SANGUE_SCURO: Aspetto = {
  corpo: '#34080e',
  numeri: '#e6dcc6',
  datiCorpo: 'rgb(255, 38, 0)',
  datiNumeri: 'rgb(70, 115, 0)',
  vene: { scuro: '#1b0306', chiaro: '#4d0e16', vena: '#8f2a30', forza: 0.4, fitte: 0.9 },
};
const ASPETTI: Record<Serie, Record<Ruolo, Aspetto>> = {
  perla: { semplice: PERLA, unita: PERLA, decine: NOTTE },
  ossidiana: { semplice: OSSIDIANA, unita: OSSIDIANA, decine: BRONZO },
  master: { semplice: SANGUE, unita: SANGUE, decine: SANGUE_SCURO },
};
/** Le vene si dipingono su una tela piccola per faccia, di tanti pixel di lato: sono larghe, e ingrandite restano lisce. */
const TELA_VENE = 64;
/** Altezza delle cifre rispetto al raggio inscritto della faccia smussata. */
const CIFRE: Record<Forma, number> = { d4: 0.74, d6: 1.2, d8: 1.08, d10: 1.25, d12: 1.05, d20: 1.12 };
/** Il tratto che ingrossa le cifre, in frazione del corpo del carattere: si leggono meglio da lontano. */
const TRATTO = 0.035;
/** Il filo scuro intorno alle cifre, dove c'è, nella stessa misura. */
const CONTORNO = 0.12;
/** Lo smusso degli spigoli, in frazione dello spigolo più corto del dado. */
const SMUSSO = 0.05;
export const CARATTERE_DADI = '"Sanctum Serif", "Noto Serif", "DejaVu Serif", serif';

/** Quello che di un dado dipende soltanto dalla forma: la mesh e come le facce stanno sulla tela. */
interface Impianto {
  geometria: THREE.BufferGeometry;
  larghezza: number;
  altezza: number;
  /** Destra e alto di ogni faccia, e i suoi vertici nel suo piano. */
  piani: { punti: [number, number][]; destra: V3; alto: V3 }[];
  /** Pixel per centimetro. */
  k: number;
  /** Il raggio inscritto della faccia più stretta, in pixel, tolto lo smusso. */
  raggio: number;
  /** Il centro della cella della faccia i, in pixel. */
  cella(i: number): [number, number];
}

interface Disegno {
  colore: THREE.CanvasTexture;
  dati: THREE.CanvasTexture;
  luce: THREE.CanvasTexture;
  materiali: Map<Tono, THREE.MeshPhysicalMaterial>;
}

const impianti = new Map<Forma, Impianto>();
const disegni = new Map<string, Disegno>();
let anisotropia = 1;

/** La scena dice quanta anisotropia regge la scheda, prima di creare i dadi. */
export function impostaAnisotropia(n: number): void {
  anisotropia = n;
}

/** La mesh di un dado: la stessa per tutte le serie, che dipingono le stesse celle. */
export function geometriaDado(forma: Forma): THREE.BufferGeometry {
  return impianto(forma).geometria;
}

export function materialeDado(forma: Forma, ruolo: Ruolo, tono: Tono, serie: Serie): THREE.MeshPhysicalMaterial {
  const d = disegno(forma, ruolo, serie);
  let m = d.materiali.get(tono);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      map: d.colore,
      roughnessMap: d.dati,
      metalnessMap: d.dati,
      bumpMap: d.dati,
      bumpScale: 1.4,
      roughness: 1,
      metalness: 1,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
      emissiveMap: d.luce,
      emissive: 0x000000,
    });
    if (tono === 'scartato') {
      m.color.set(0x5a5a5a);
      m.clearcoat = 0.3;
    }
    if (tono === 'oro') {
      m.emissive.set(0xffb648);
      m.emissiveIntensity = 1.3;
    }
    if (tono === 'rosso') {
      m.color.set(0xff5644);
      m.emissive.set(0xff2a18);
      m.emissiveIntensity = 0.9;
    }
    d.materiali.set(tono, m);
  }
  return m;
}

/** Coordinate dei vertici di una faccia nel suo piano: x a destra, y verso la cima del numero. */
function pianoFaccia(forma: Forma, i: number): { punti: [number, number][]; destra: V3; alto: V3 } {
  const g = geometria(forma);
  const c = g.centri[i]!;
  const alto = g.alto[i]!;
  // Guardando la faccia da fuori, destra × alto = normale uscente.
  const destra = vettoriale(alto, g.normali[i]!);
  const punti = g.facce[i]!.map((vi): [number, number] => {
    const d = diff(g.vertici[vi]!, c);
    return [punto(d, destra), punto(d, alto)];
  });
  return { punti, destra, alto };
}

/** Distanza minima dal centro (l'origine del piano) ai lati del poligono. */
function raggioInscritto(punti: readonly [number, number][]): number {
  let r = Infinity;
  for (let k = 0; k < punti.length; k++) {
    const [ax, ay] = punti[k]!;
    const [bx, by] = punti[(k + 1) % punti.length]!;
    const lato = Math.hypot(bx - ax, by - ay);
    r = Math.min(r, Math.abs(ax * by - ay * bx) / lato);
  }
  return r;
}

function spigoloMinimo(forma: Forma): number {
  const g = geometria(forma);
  let m = Infinity;
  for (const f of g.facce) {
    for (let j = 0; j < f.length; j++) m = Math.min(m, lunghezza(diff(g.vertici[f[j]!]!, g.vertici[f[(j + 1) % f.length]!]!)));
  }
  return m;
}

type UV = readonly [number, number];
interface Punto3 {
  p: V3;
  n: V3;
  uv: UV;
}

/**
 * Il poliedro con gli spigoli smussati. Ogni faccia rientra di `smusso` dai suoi lati restando sul suo
 * piano; fra due facce vicine una striscia, e a ogni vertice un ventaglio. Le normali della striscia
 * passano da una faccia all'altra e quelle del ventaglio puntano dal centro al vertice: la luce li legge
 * come spigoli arrotondati. Strisce e ventagli prendono il colore del corpo (`uvCorpo`).
 */
function poliedroSmussato(forma: Forma, smusso: number, uvFaccia: (i: number, p: V3) => UV, uvCorpo: UV): THREE.BufferGeometry {
  const g = geometria(forma);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const triangolo = (a: Punto3, b: Punto3, c: Punto3, fuori: V3) => {
    const verso = punto(vettoriale(diff(b.p, a.p), diff(c.p, a.p)), fuori);
    const terna = verso < 0 ? [a, c, b] : [a, b, c];
    for (const t of terna) {
      pos.push(t.p[0], t.p[1], t.p[2]);
      nrm.push(t.n[0], t.n[1], t.n[2]);
      uv.push(t.uv[0], t.uv[1]);
    }
  };

  // Il vertice j della faccia i, rientrato di `smusso` da entrambi i lati che vi si incontrano.
  const rientri: V3[][] = g.facce.map((f, i) => {
    const n = g.normali[i]!;
    return f.map((vi, j) => {
      const v = g.vertici[vi]!;
      const prima = g.vertici[f[(j + f.length - 1) % f.length]!]!;
      const dopo = g.vertici[f[(j + 1) % f.length]!]!;
      // Le facce girano in senso antiorario viste da fuori: l'interno sta a sinistra di ogni lato, n × lato.
      const m1 = normalizza(vettoriale(n, normalizza(diff(v, prima))));
      const m2 = normalizza(vettoriale(n, normalizza(diff(dopo, v))));
      return somma(v, scala(somma(m1, m2), smusso / (1 + punto(m1, m2))));
    });
  });

  g.facce.forEach((f, i) => {
    const n = g.normali[i]!;
    const r = rientri[i]!;
    const p = (j: number): Punto3 => ({ p: r[j]!, n, uv: uvFaccia(i, r[j]!) });
    for (let j = 1; j + 1 < f.length; j++) triangolo(p(0), p(j), p(j + 1), n);
  });

  // Le strisce: ogni lato una volta, fra la faccia che lo percorre a → b e quella che lo percorre b → a.
  const lati = new Map<string, { faccia: number; j: number }>();
  g.facce.forEach((f, i) => f.forEach((a, j) => lati.set(`${a}>${f[(j + 1) % f.length]}`, { faccia: i, j })));
  g.facce.forEach((f, i) =>
    f.forEach((a, j) => {
      const b = f[(j + 1) % f.length]!;
      if (a > b) return;
      const altro = lati.get(`${b}>${a}`);
      if (!altro) throw new Error(`${forma}: il lato ${a}-${b} ha una faccia sola`);
      const k = altro.faccia;
      const nk = g.normali[k]!;
      const ni = g.normali[i]!;
      const fuori = normalizza(somma(ni, nk));
      const pa: Punto3 = { p: rientri[i]![j]!, n: ni, uv: uvCorpo };
      const pb: Punto3 = { p: rientri[i]![(j + 1) % f.length]!, n: ni, uv: uvCorpo };
      const qb: Punto3 = { p: rientri[k]![altro.j]!, n: nk, uv: uvCorpo };
      const qa: Punto3 = { p: rientri[k]![(altro.j + 1) % g.facce[k]!.length]!, n: nk, uv: uvCorpo };
      triangolo(pa, pb, qb, fuori);
      triangolo(pa, qb, qa, fuori);
    }),
  );

  // I ventagli: i vertici rientrati delle facce intorno a un vertice, in giro intorno al suo asse.
  g.vertici.forEach((v, vi) => {
    const asse = normalizza(v);
    const anello: Punto3[] = [];
    g.facce.forEach((f, i) => {
      const j = f.indexOf(vi);
      if (j >= 0) anello.push({ p: rientri[i]![j]!, n: g.normali[i]!, uv: uvCorpo });
    });
    const piatto = (p: V3) => diff(p, scala(asse, punto(p, asse)));
    const x = normalizza(piatto(anello[0]!.p));
    const y = vettoriale(asse, x);
    const angolo = (q: Punto3) => Math.atan2(punto(piatto(q.p), y), punto(piatto(q.p), x));
    anello.sort((a, b) => angolo(a) - angolo(b));
    const centro: Punto3 = { p: scala(anello.reduce<V3>((s, q) => somma(s, q.p), [0, 0, 0]), 1 / anello.length), n: asse, uv: uvCorpo };
    for (let k = 0; k < anello.length; k++) triangolo(centro, anello[k]!, anello[(k + 1) % anello.length]!, asse);
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

interface Pennello {
  fondo: string;
  numeri: string;
  contorno?: string;
  /** Le vene del corpo e il seme da cui escono. */
  vene?: Vene;
  seme?: number;
}

function impianto(forma: Forma): Impianto {
  let im = impianti.get(forma);
  if (im) return im;
  const g = geometria(forma);
  const n = g.facce.length;
  const colonne = Math.ceil(Math.sqrt(n));
  const righe = Math.ceil(n / colonne);
  const larghezza = colonne * CELLA;
  const altezza = righe * CELLA;
  const piani = g.facce.map((_, i) => pianoFaccia(forma, i));
  // Una scala sola per tutte le facce, così i numeri hanno la stessa misura.
  const estensione = Math.max(...piani.flatMap((p) => p.punti.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)])));
  const k = (CELLA / 2 - MARGINE) / estensione;
  const smusso = SMUSSO * spigoloMinimo(forma);
  const raggio = (Math.min(...piani.map((p) => raggioInscritto(p.punti))) - smusso) * k;
  const cella = (i: number): [number, number] => [(i % colonne) * CELLA + CELLA / 2, Math.floor(i / colonne) * CELLA + CELLA / 2];
  const uvFaccia = (i: number, p: V3): UV => {
    const [cx, cy] = cella(i);
    const { destra, alto } = piani[i]!;
    const dd = diff(p, g.centri[i]!);
    const px = cx + punto(dd, destra) * k;
    const py = cy - punto(dd, alto) * k;
    return [px / larghezza, 1 - py / altezza];
  };
  // Un pixel del margine della prima cella: lì c'è soltanto il corpo, in tutte le tele.
  const uvCorpo: UV = [3 / larghezza, 1 - 3 / altezza];
  im = { geometria: poliedroSmussato(forma, smusso, uvFaccia, uvCorpo), larghezza, altezza, piani, k, raggio, cella };
  impianti.set(forma, im);
  return im;
}

/** Rumore a valori su un reticolo, liscio, fra 0 e 1: lo stesso seme dà le stesse nuvole. */
function rumore(seme: number): (x: number, y: number, z: number) => number {
  const caso = (x: number, y: number, z: number) => {
    let n = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1) ^ seme) | 0;
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  };
  const liscia = (v: number) => v * v * (3 - 2 * v);
  const fra = (a: number, b: number, v: number) => a + (b - a) * v;
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = liscia(x - xi);
    const v = liscia(y - yi);
    const w = liscia(z - zi);
    return fra(
      fra(fra(caso(xi, yi, zi), caso(xi + 1, yi, zi), u), fra(caso(xi, yi + 1, zi), caso(xi + 1, yi + 1, zi), u), v),
      fra(fra(caso(xi, yi, zi + 1), caso(xi + 1, yi, zi + 1), u), fra(caso(xi, yi + 1, zi + 1), caso(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
}

const terna = (esadecimale: string): [number, number, number] => {
  const n = parseInt(esadecimale.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

/**
 * Le vene della resina su tutte le celle. Ogni pixel prende il colore del punto del dado che gli sta sotto,
 * da un rumore nello spazio: le nuvole passano da una faccia all'altra senza interrompersi, come in un
 * dado colato davvero.
 */
function dipingiVene(ctx: CanvasRenderingContext2D, forma: Forma, im: Impianto, vene: Vene, seme: number): void {
  const g = geometria(forma);
  const base = rumore(seme);
  const nuvola = (x: number, y: number, z: number) => (base(x, y, z) + 0.5 * base(2 * x + 11.3, 2 * y + 4.7, 2 * z + 8.1) + 0.25 * base(4 * x + 3.1, 4 * y + 17.9, 4 * z + 6.4)) / 1.75;
  const gradino = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    return c * c * (3 - 2 * c);
  };
  const scuro = terna(vene.scuro);
  const chiaro = terna(vene.chiaro);
  const vena = terna(vene.vena);
  const piccola = document.createElement('canvas');
  piccola.width = TELA_VENE;
  piccola.height = TELA_VENE;
  const pc = piccola.getContext('2d');
  if (!pc) throw new Error('canvas 2D non disponibile');
  const immagine = pc.createImageData(TELA_VENE, TELA_VENE);
  const passo = CELLA / TELA_VENE / im.k;
  for (let i = 0; i < im.piani.length; i++) {
    const { destra, alto } = im.piani[i]!;
    const c = g.centri[i]!;
    for (let py = 0; py < TELA_VENE; py++) {
      const su = (TELA_VENE / 2 - py - 0.5) * passo;
      for (let px = 0; px < TELA_VENE; px++) {
        const a = (px + 0.5 - TELA_VENE / 2) * passo;
        const x = (c[0] + destra[0] * a + alto[0] * su) * vene.fitte;
        const y = (c[1] + destra[1] * a + alto[1] * su) * vene.fitte;
        const z = (c[2] + destra[2] * a + alto[2] * su) * vene.fitte;
        // Le nuvole si piegano l'una sull'altra: il punto si sposta di quanto dice un secondo rumore.
        const t = nuvola(x + 2.4 * nuvola(x + 5.2, y + 1.3, z + 7.1), y + 2.4 * nuvola(x + 1.7, y + 9.2, z + 3.3), z + 2.4 * nuvola(x + 8.3, y + 2.8, z + 4.9));
        const quanto = gradino((t - 0.32) / 0.36);
        // La vena corre dove i due colori si incontrano.
        const filo = vene.forza * gradino((1 - Math.abs(2 * quanto - 1) - 0.72) / 0.26);
        const o = (py * TELA_VENE + px) * 4;
        for (let k = 0; k < 3; k++) {
          const fondo = scuro[k]! + (chiaro[k]! - scuro[k]!) * quanto;
          immagine.data[o + k] = fondo + (vena[k]! - fondo) * filo;
        }
        immagine.data[o + 3] = 255;
      }
    }
    pc.putImageData(immagine, 0, 0);
    const [cx, cy] = im.cella(i);
    ctx.drawImage(piccola, cx - CELLA / 2, cy - CELLA / 2, CELLA, CELLA);
  }
}

function disegno(forma: Forma, ruolo: Ruolo, serie: Serie): Disegno {
  const chiave = `${forma}:${ruolo}:${serie}`;
  let d = disegni.get(chiave);
  if (d) return d;
  const g = geometria(forma);
  const im = impianto(forma);
  const { larghezza, altezza, piani, k, raggio, cella } = im;

  /** Sfondo e numeri di tutte le facce, con i colori del pennello, alla scala data. */
  const dipingi = (scalaTela: number, pennello: Pennello): HTMLCanvasElement => {
    const tela = document.createElement('canvas');
    tela.width = Math.round(larghezza * scalaTela);
    tela.height = Math.round(altezza * scalaTela);
    const ctx = tela.getContext('2d');
    if (!ctx) throw new Error('canvas 2D non disponibile');
    ctx.scale(scalaTela, scalaTela);
    ctx.fillStyle = pennello.fondo;
    ctx.fillRect(0, 0, larghezza, altezza);
    if (pennello.vene) {
      dipingiVene(ctx, forma, im, pennello.vene, pennello.seme ?? 0);
      // L'angolo da cui gli spigoli prendono il colore resta del colore del corpo.
      ctx.fillRect(0, 0, MARGINE - 1, MARGINE - 1);
    }
    for (let i = 0; i < piani.length; i++) {
      const [cx, cy] = cella(i);
      const { punti } = piani[i]!;
      if (g.letturaInBasso) {
        // d4: tre numeri per faccia, uno per vertice, con la cima verso il vertice.
        g.facce[i]!.forEach((vi, j) => {
          const [x, y] = punti[j]!;
          scrivi(ctx, String(g.valoriVertici![vi]), cx + x * k * 0.54, cy - y * k * 0.54, Math.atan2(x, y), raggio * CIFRE[forma], raggio * 1.1, pennello.numeri, pennello.contorno);
        });
      } else {
        scrivi(ctx, etichetta(forma, ruolo, g.letture[i]!), cx, cy, 0, raggio * CIFRE[forma], raggio * 1.7, pennello.numeri, pennello.contorno);
      }
    }
    return tela;
  };

  const aspetto = ASPETTI[serie][ruolo];
  // Il seme delle vene viene dal nome del dado: ogni tipo ha le sue, sempre quelle.
  let seme = 2166136261;
  for (const c of chiave) seme = Math.imul(seme ^ c.charCodeAt(0), 16777619);
  const colore = new THREE.CanvasTexture(dipingi(1, { fondo: aspetto.corpo, numeri: aspetto.numeri, contorno: aspetto.contorno, vene: aspetto.vene, seme }));
  colore.colorSpace = THREE.SRGBColorSpace;
  const dati = new THREE.CanvasTexture(dipingi(SCALA_DATI, { fondo: aspetto.datiCorpo, numeri: aspetto.datiNumeri }));
  const luce = new THREE.CanvasTexture(dipingi(SCALA_DATI, { fondo: '#000000', numeri: '#ffffff' }));
  luce.colorSpace = THREE.SRGBColorSpace;
  for (const tx of [colore, dati, luce]) tx.anisotropy = anisotropia;

  d = { colore, dati, luce, materiali: new Map() };
  disegni.set(chiave, d);
  return d;
}

/**
 * Un numero centrato in (x, y), ruotato di `angolo` (radianti, in senso orario sulla tela),
 * alto `altezza` pixel di cifra e largo al più `larghezzaMassima`. 6 e 9 si sottolineano.
 */
function scrivi(
  ctx: CanvasRenderingContext2D,
  testo: string,
  x: number,
  y: number,
  angolo: number,
  altezza: number,
  larghezzaMassima: number,
  colore: string,
  contorno?: string,
): void {
  // Le cifre sono alte circa 0,71 em: da lì la misura del carattere.
  let corpo = altezza / 0.71;
  ctx.font = `700 ${corpo}px ${CARATTERE_DADI}`;
  let m = ctx.measureText(testo);
  // Il tratto allarga la scritta di quanto è spesso.
  const larga = m.width + corpo * TRATTO;
  if (larga > larghezzaMassima) {
    corpo *= larghezzaMassima / larga;
    ctx.font = `700 ${corpo}px ${CARATTERE_DADI}`;
    m = ctx.measureText(testo);
  }
  const su = m.actualBoundingBoxAscent;
  const giu = m.actualBoundingBoxDescent;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angolo);
  ctx.fillStyle = colore;
  ctx.strokeStyle = colore;
  ctx.lineWidth = corpo * TRATTO;
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Centro verticale sull'altezza misurata delle cifre (la riga del carattere ha spazio sopra e sotto).
  const base = (su - giu) / 2;
  const spessore = Math.max(2, corpo * 0.09);
  const riga = m.width * 0.75;
  const sotto = (su + giu) / 2 + corpo * 0.08;
  if (contorno) {
    ctx.strokeStyle = contorno;
    ctx.lineWidth = corpo * CONTORNO;
    ctx.strokeText(testo, 0, base);
    if (vaSottolineata(testo)) ctx.strokeRect(-riga / 2, sotto, riga, spessore);
    ctx.strokeStyle = colore;
    ctx.lineWidth = corpo * TRATTO;
  }
  ctx.fillText(testo, 0, base);
  ctx.strokeText(testo, 0, base);
  if (vaSottolineata(testo)) ctx.fillRect(-riga / 2, sotto, riga, spessore);
  ctx.restore();
}
