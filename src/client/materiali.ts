// I materiali del tavolo: noce, velluto, ottone, e la stanza che i dadi riflettono.
// Noce della cornice, velluto del fondo e assi del tavolo vengono da foto generate con Flux (flux-3-image)
// e preparate da ~/Immagini/Dice_Sanctum_trame/prepara.py: tolta la luce grande cotta nella foto, la media
// portata al colore del tavolo, rilievo e ruvidezza ricavati dalla grana.

import * as THREE from 'three';

const INDIRIZZI = {
  noce: new URL('./trame/noce.webp', import.meta.url).href,
  noceRilievo: new URL('./trame/noce-rilievo.webp', import.meta.url).href,
  noceRuvidezza: new URL('./trame/noce-ruvidezza.webp', import.meta.url).href,
  velluto: new URL('./trame/velluto.webp', import.meta.url).href,
  tavolo: new URL('./trame/tavolo.webp', import.meta.url).href,
  tavoloRilievo: new URL('./trame/tavolo-rilievo.webp', import.meta.url).href,
  tavoloRuvidezza: new URL('./trame/tavolo-ruvidezza.webp', import.meta.url).href,
};

export type Trame = Record<keyof typeof INDIRIZZI, THREE.Texture>;

/** Le trame, caricate prima della scena: senza, il vassoio comparirebbe nudo per qualche fotogramma. */
export async function caricaTrame(): Promise<Trame> {
  const caricatore = new THREE.TextureLoader();
  const voci = await Promise.all(
    Object.entries(INDIRIZZI).map(async ([nome, indirizzo]) => [nome, await caricatore.loadAsync(indirizzo)] as const),
  );
  return Object.fromEntries(voci) as Trame;
}

/**
 * Una trama che copre `lato` centimetri sulle coordinate in centimetri centrate sullo zero: lo spostamento
 * di mezza trama tiene il pezzo che si vede dentro una foto sola. Oltre il bordo la foto si specchia, così
 * una finestra molto larga trova una piega al posto di una giunta.
 */
function inCentimetri(t: THREE.Texture, lato: number, colore: boolean, anisotropia: number): THREE.Texture {
  if (colore) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.MirroredRepeatWrapping;
  t.wrapT = THREE.MirroredRepeatWrapping;
  t.repeat.set(1 / lato, 1 / lato);
  t.offset.set(0.5, 0.5);
  t.anisotropy = anisotropia;
  return t;
}

/** Legno finito a olio o a cera: la foto, il rilievo di pori, fughe e graffi, la ruvidezza del dettaglio. */
export function materialeLegno(o: {
  colore: THREE.Texture;
  rilievo: THREE.Texture;
  ruvidezza: THREE.Texture;
  /** I centimetri che la foto copre. */
  lato: number;
  forzaRilievo: number;
  anisotropia: number;
}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: inCentimetri(o.colore, o.lato, true, o.anisotropia),
    bumpMap: inCentimetri(o.rilievo, o.lato, false, o.anisotropia),
    bumpScale: o.forzaRilievo,
    roughnessMap: inCentimetri(o.ruvidezza, o.lato, false, o.anisotropia),
    roughness: 1,
    metalness: 0,
  });
}

/** Velluto borgogna: la foto copre tutto il fondo; il riflesso radente del pelo lo dà la lucentezza («sheen»). */
export function materialeVelluto(colore: THREE.Texture, anisotropia: number): THREE.MeshPhysicalMaterial {
  colore.colorSpace = THREE.SRGBColorSpace;
  colore.anisotropy = anisotropia;
  return new THREE.MeshPhysicalMaterial({
    map: colore,
    roughness: 0.95,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color(0xb04a5c),
  });
}

/** Ottone antico: metallo caldo, non lucidato a specchio. */
export function materialeOttone(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.34 });
}

/**
 * La stanza che i dadi riflettono: buia, con la lampada sopra il tavolo, il bagliore del camino a
 * sinistra e una finestra fredda in fondo a destra. Senza, l'ossidiana lucida sembra plastica opaca.
 */
export function ambiente(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  const usa: { dispose(): void }[] = [];
  const stanza = new THREE.Mesh(new THREE.BoxGeometry(120, 70, 120), new THREE.MeshBasicMaterial({ color: 0x140d08, side: THREE.BackSide }));
  stanza.position.y = 25;
  s.add(stanza);
  usa.push(stanza.geometry, stanza.material);
  const pannello = (l: number, a: number, colore: number, forza: number, dove: V, verso: V) => {
    const g = new THREE.PlaneGeometry(l, a);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(colore).multiplyScalar(forza), side: THREE.DoubleSide });
    const p = new THREE.Mesh(g, m);
    p.position.set(dove[0], dove[1], dove[2]);
    p.lookAt(verso[0], verso[1], verso[2]);
    s.add(p);
    usa.push(g, m);
  };
  pannello(34, 22, 0xffd8a8, 7, [-8, 56, 8], [0, 0, 0]);
  // Alle spalle del tavolo, dove guardano le facce di sopra dei dadi viste dalla camera: senza, riflettono buio.
  pannello(46, 24, 0xffe0bc, 2.6, [0, 44, -50], [0, 0, 0]);
  pannello(12, 26, 0xff9440, 2.2, [-58, 14, -6], [0, 12, 0]);
  pannello(16, 24, 0x5f7fb6, 0.9, [44, 28, -56], [0, 12, 0]);
  pannello(60, 3, 0xffc890, 0.5, [0, 4, 58], [0, 4, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Lontano 200: gli angoli della stanza stanno a 104 cm dal centro, oltre i 100 di serie.
  const rt = pmrem.fromScene(s, 0.03, 0.1, 200);
  pmrem.dispose();
  for (const u of usa) u.dispose();
  return rt.texture;
}

type V = readonly [number, number, number];
