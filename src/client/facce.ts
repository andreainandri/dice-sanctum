// Le mesh dei dadi e le loro facce dipinte: il set Obsidian & Gold, corpo nero lucido e numeri d'oro incisi.
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

const CELLA = 256;
const MARGINE = 8;
/** Le tele dei dati (rilievo, ruvidezza, metallo) e della luce dei numeri, in frazione della tela del colore. */
const SCALA_DATI = 0.5;
/**
 * Colore di corpo e numeri, e i loro valori sulla tela dei dati: rosso il rilievo (il corpo in alto, i
 * numeri incisi), verde la ruvidezza, blu il metallo.
 */
interface Aspetto {
  corpo: string;
  numeri: string;
  datiCorpo: string;
  datiNumeri: string;
}

/** Ossidiana: resina nera lucida, numeri d'oro. */
const OSSIDIANA: Aspetto = { corpo: '#0d0c0f', numeri: '#caa252', datiCorpo: 'rgb(255, 38, 0)', datiNumeri: 'rgb(70, 90, 255)' };
/** Bronzo brunito coi numeri neri: il d10 delle decine si distingue dal compagno del d100 su qualunque fondo. */
const BRONZO: Aspetto = { corpo: '#7a5a38', numeri: '#121014', datiCorpo: 'rgb(255, 105, 140)', datiNumeri: 'rgb(70, 115, 0)' };
const ASPETTI: Record<Ruolo, Aspetto> = { semplice: OSSIDIANA, unita: OSSIDIANA, decine: BRONZO };
/** Altezza delle cifre rispetto al raggio inscritto della faccia smussata. */
const CIFRE: Record<Forma, number> = { d4: 0.66, d6: 0.95, d8: 0.92, d10: 1.15, d12: 0.88, d20: 0.98 };
/** Lo smusso degli spigoli, in frazione dello spigolo più corto del dado. */
const SMUSSO = 0.05;
export const CARATTERE_DADI = '"Sanctum Serif", "Noto Serif", "DejaVu Serif", serif';

interface Disegno {
  geometria: THREE.BufferGeometry;
  colore: THREE.CanvasTexture;
  dati: THREE.CanvasTexture;
  luce: THREE.CanvasTexture;
  materiali: Map<Tono, THREE.MeshPhysicalMaterial>;
}

const disegni = new Map<string, Disegno>();
let anisotropia = 1;

/** La scena dice quanta anisotropia regge la scheda, prima di creare i dadi. */
export function impostaAnisotropia(n: number): void {
  anisotropia = n;
}

export function geometriaDado(forma: Forma, ruolo: Ruolo): THREE.BufferGeometry {
  return disegno(forma, ruolo).geometria;
}

export function materialeDado(forma: Forma, ruolo: Ruolo, tono: Tono): THREE.MeshPhysicalMaterial {
  const d = disegno(forma, ruolo);
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
}

function disegno(forma: Forma, ruolo: Ruolo): Disegno {
  const chiave = `${forma}:${ruolo}`;
  let d = disegni.get(chiave);
  if (d) return d;
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
    for (let i = 0; i < n; i++) {
      const [cx, cy] = cella(i);
      const { punti } = piani[i]!;
      if (g.letturaInBasso) {
        // d4: tre numeri per faccia, uno per vertice, con la cima verso il vertice.
        g.facce[i]!.forEach((vi, j) => {
          const [x, y] = punti[j]!;
          scrivi(ctx, String(g.valoriVertici![vi]), cx + x * k * 0.54, cy - y * k * 0.54, Math.atan2(x, y), raggio * CIFRE[forma], raggio * 1.1, pennello.numeri);
        });
      } else {
        scrivi(ctx, etichetta(forma, ruolo, g.letture[i]!), cx, cy, 0, raggio * CIFRE[forma], raggio * 1.7, pennello.numeri);
      }
    }
    return tela;
  };

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

  const aspetto = ASPETTI[ruolo];
  const colore = new THREE.CanvasTexture(dipingi(1, { fondo: aspetto.corpo, numeri: aspetto.numeri }));
  colore.colorSpace = THREE.SRGBColorSpace;
  const dati = new THREE.CanvasTexture(dipingi(SCALA_DATI, { fondo: aspetto.datiCorpo, numeri: aspetto.datiNumeri }));
  const luce = new THREE.CanvasTexture(dipingi(SCALA_DATI, { fondo: '#000000', numeri: '#ffffff' }));
  luce.colorSpace = THREE.SRGBColorSpace;
  for (const t of [colore, dati, luce]) t.anisotropy = anisotropia;

  d = { geometria: poliedroSmussato(forma, smusso, uvFaccia, uvCorpo), colore, dati, luce, materiali: new Map() };
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
): void {
  // Le cifre sono alte circa 0,71 em: da lì la misura del carattere.
  let corpo = altezza / 0.71;
  ctx.font = `700 ${corpo}px ${CARATTERE_DADI}`;
  let m = ctx.measureText(testo);
  if (m.width > larghezzaMassima) {
    corpo *= larghezzaMassima / m.width;
    ctx.font = `700 ${corpo}px ${CARATTERE_DADI}`;
    m = ctx.measureText(testo);
  }
  const su = m.actualBoundingBoxAscent;
  const giu = m.actualBoundingBoxDescent;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angolo);
  ctx.fillStyle = colore;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Centro verticale sull'altezza misurata delle cifre (la riga del carattere ha spazio sopra e sotto).
  ctx.fillText(testo, 0, (su - giu) / 2);
  if (vaSottolineata(testo)) {
    const spessore = Math.max(2, corpo * 0.07);
    const larga = m.width * 0.75;
    ctx.fillRect(-larga / 2, (su + giu) / 2 + corpo * 0.08, larga, spessore);
  }
  ctx.restore();
}
