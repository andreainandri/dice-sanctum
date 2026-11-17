// La scena 3D: il vassoio in noce sul tavolo dello studio, la lampada, la camera fissa e le mesh dei dadi.
// Disegna soltanto quando serve: durante un tiro a ogni fotogramma, da fermo una volta per cambiamento
// (dimensioni, colori).

import * as THREE from 'three';
import { type ConfigFisica } from '../physics/config.ts';
import { misureCorte, misureTorre } from '../physics/torre.ts';
import { type SpecDado } from '../physics/vassoio.ts';
import { FORME, type Ruolo, geometria } from '../shared/dadi.ts';
import { type Quat, type V3 } from '../shared/vettori.ts';
import { type Serie, type SerieDelGiocatore, TONI, type Tono, geometriaDado, impostaAnisotropia, materialeDado } from './facce.ts';
import { type MisureCornice, geometriaCornice, geometriaFilo } from './cornice.ts';
import { campoDellaTarga, pezziDellaFacciata, quotaDiTaglio } from './facciata.ts';
import { type Trame, ambiente, materialeLegno, materialeOttone, materialeVelluto } from './materiali.ts';

/** Inclinazione della camera dalla verticale. */
const INCLINAZIONE = (40 * Math.PI) / 180;
/** Quanto del riquadro occupa il vassoio, in coordinate normalizzate. */
const RIEMPIMENTO = { x: 0.94, y: 0.9 };
/**
 * Il vassoio che si vede, in centimetri: soltanto disegno. Altezza e spessore delle sponde stanno nella
 * configurazione, accanto alle misure della fisica; le facce interne delle sponde stanno sui suoi piani.
 */
const VASSOIO = {
  /** Altezza del fondo sopra il tavolo. */
  base: 1.6,
  /** Quanto è larga la cornice che si vede: più della sponda della fisica, che ne è la faccia di dentro. */
  larga: 3,
  /** Raggio degli angoli fuori e dentro, visti dall'alto. */
  angoloFuori: 2.2,
  angoloDentro: 0.3,
  /** Lo smusso che arrotonda gli spigoli in cima e in fondo. */
  smusso: 0.55,
  /** Il filo d'ottone sulla cima, a questa distanza dal bordo interno, e largo tanto. */
  filoDistanza: 0.75,
  filoLarghezza: 0.15,
} as const;

/**
 * Il lampo del 20 naturale: quanto dura, la luce calda sopra il dado (forza, colore, portata in centimetri,
 * altezza sul centro del dado) e quanto si accendono i suoi numeri.
 */
const LAMPO = { durata: 1100, salita: 0.12, luce: 150, colore: 0xffc46a, portata: 9, altezza: 2.6, numeri: 3.5 } as const;

/** Coordinate di trama in centimetri dal centro del piano, come quelle della cornice. */
function uvInCentimetri(g: THREE.BufferGeometry, l: number, a: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * l, (uv.getY(i) - 0.5) * a);
  return g;
}

/**
 * Una scatola con le UV in centimetri, faccia per faccia, come le vuole il legno. `scarto` sposta la foto,
 * perché due pezzi vicini non mostrino lo stesso nodo.
 */
function scatolaInCentimetri(l: number, a: number, p: number, scarto: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(l, a, p);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Le facce di BoxGeometry, quattro vertici l'una: +x, -x, +y, -y, +z, -z.
  const misure: [number, number][] = [[p, a], [p, a], [l, p], [l, p], [l, a], [l, a]];
  for (let f = 0; f < 6; f++) {
    const [u, v] = misure[f]!;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) - 0.5) * u + scarto, (uv.getY(i) - 0.5) * v + scarto / 2);
    }
  }
  return g;
}

export class Scena {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scena = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 1, 600);
  private readonly contenitore: HTMLElement;
  private readonly cfg: ConfigFisica;
  private readonly osservatore: ResizeObserver;
  private readonly risorse: { dispose(): void }[] = [];
  private dadi: { mesh: THREE.Mesh; spec: SpecDado; serie: Serie; tono: Tono }[] = [];
  /** La serie con cui tira chi gioca al tavolo. */
  private serieDelGiocatore: SerieDelGiocatore;
  private disegnoChiesto = false;
  /**
   * La luce del lampo sta sempre in scena, spenta: aggiungerla al momento del 20 cambierebbe il numero
   * delle luci e farebbe ricompilare ogni materiale proprio in quel fotogramma.
   */
  private readonly luceLampo = new THREE.PointLight(LAMPO.colore, 0, LAMPO.portata, 2);
  /** Lampada, cielo e luce di profilo, centrati sulla corte. */
  private readonly luci = new THREE.Group();
  private lampoAttivo: { materiale: THREE.MeshPhysicalMaterial; riposo: number; inizio: number; giro: number } | null = null;

  constructor(contenitore: HTMLElement, cfg: ConfigFisica, trame: Trame, serie: SerieDelGiocatore = 'perla') {
    this.contenitore = contenitore;
    this.cfg = cfg;
    this.serieDelGiocatore = serie;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    impostaAnisotropia(aniso);
    contenitore.appendChild(this.renderer.domElement);
    this.scena.background = new THREE.Color(0x080605);
    const stanza = ambiente(this.renderer);
    this.risorse.push(stanza);
    this.scena.environment = stanza;
    this.scena.environmentIntensity = 0.6;
    this.costruisciVassoio(trame, aniso);
    this.accendiLuci();
    this.scena.add(this.luceLampo);
    this.osservatore = new ResizeObserver(() => this.adatta());
    this.osservatore.observe(contenitore);
    this.adatta();
    this.prepara();
  }

  /**
   * Dipinge subito le facce dei dadi che possono arrivare sul vassoio (la serie di chi gioca e quella del
   * master) e compila i materiali: senza, il primo tiro di ogni tipo di dado perdeva un fotogramma da
   * 50 ms mentre la tela andava alla scheda video.
   */
  private prepara(): void {
    this.preparaSerie(this.serieDelGiocatore);
    this.preparaSerie('master');
  }

  private preparaSerie(serie: Serie): void {
    const prova: THREE.Mesh[] = [];
    for (const forma of FORME) {
      const ruoli: Ruolo[] = forma === 'd10' ? ['semplice', 'decine', 'unita'] : ['semplice'];
      for (const ruolo of ruoli) {
        for (const tono of TONI) {
          const m = new THREE.Mesh(geometriaDado(forma), materialeDado(forma, ruolo, tono, serie));
          m.castShadow = true;
          prova.push(m);
          this.scena.add(m);
        }
        const m = materialeDado(forma, ruolo, 'normale', serie);
        for (const t of [m.map, m.roughnessMap, m.emissiveMap]) if (t) this.renderer.initTexture(t);
      }
    }
    this.renderer.compile(this.scena, this.camera);
    for (const m of prova) this.scena.remove(m);
  }

  /** Cambia la serie di chi gioca: i suoi dadi già sul vassoio la prendono subito, quelli del master restano. */
  scegliSerie(serie: SerieDelGiocatore): void {
    if (serie === this.serieDelGiocatore) return;
    this.serieDelGiocatore = serie;
    this.preparaSerie(serie);
    for (const d of this.dadi) {
      if (d.serie === 'master') continue;
      d.serie = serie;
      d.mesh.material = materialeDado(d.spec.forma, d.spec.ruolo, d.tono, serie);
    }
    this.richiediDisegno();
  }

  private aggiungi(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial, ombra: { getta: boolean; riceve: boolean }): THREE.Mesh {
    this.risorse.push(g, m);
    for (const t of [m.map, m.roughnessMap, m.bumpMap]) if (t) this.risorse.push(t);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = ombra.getta;
    mesh.receiveShadow = ombra.riceve;
    this.scena.add(mesh);
    return mesh;
  }

  private get misureCornice(): MisureCornice {
    const { larghezza, profondita, sponda } = this.cfg.vassoio;
    return { larghezza, profondita, spessore: VASSOIO.larga, sponda, angoloDentro: VASSOIO.angoloDentro, angoloFuori: VASSOIO.angoloFuori, smusso: VASSOIO.smusso, base: VASSOIO.base };
  }

  /** Il vassoio intagliato in un pezzo di noce, col fondo di velluto e il filo d'ottone sulla cima, posato sul tavolo. */
  private costruisciVassoio(trame: Trame, aniso: number): void {
    const V = VASSOIO;

    const noce = materialeLegno({
      colore: trame.noce,
      rilievo: trame.noceRilievo,
      ruvidezza: trame.noceRuvidezza,
      lato: 40,
      forzaRilievo: 0.6,
      anisotropia: aniso,
    });
    this.aggiungi(geometriaCornice(this.misureCornice), noce, { getta: true, riceve: true });
    this.aggiungi(geometriaFilo(this.misureCornice, V.filoDistanza, V.filoLarghezza), materialeOttone(), { getta: false, riceve: true });

    // Il velluto copre la corte; sotto la torre il fondo lo copre la rampa.
    const corte = misureCorte(this.cfg);
    const piano = new THREE.PlaneGeometry(corte.x1 - corte.x0, corte.z1 - corte.z0);
    piano.rotateX(-Math.PI / 2);
    piano.translate((corte.x0 + corte.x1) / 2, 0, (corte.z0 + corte.z1) / 2);
    // La foto del velluto ha le proporzioni della corte e la copre una volta sola.
    this.aggiungi(piano, materialeVelluto(trame.velluto, aniso), { getta: false, riceve: true });

    const tavola = uvInCentimetri(new THREE.PlaneGeometry(400, 400), 400, 400);
    tavola.rotateX(-Math.PI / 2);
    tavola.translate(0, -V.base, 0);
    const assi = materialeLegno({
      colore: trame.tavolo,
      rilievo: trame.tavoloRilievo,
      ruvidezza: trame.tavoloRuvidezza,
      lato: 120,
      forzaRilievo: 0.8,
      anisotropia: aniso,
    });
    this.aggiungi(tavola, assi, { getta: false, riceve: true });
    this.costruisciTorre(noce);
  }

  /**
   * La torre dei dadi, nello stesso noce del vassoio e con le misure della fisica: la parete di fondo, le
   * due di fianco e la facciata verso la corte sopra l'arco, vestita dei suoi intagli (vedi facciata.ts).
   * Le pareti di fuori stanno sulla cornice del vassoio. Dentro, gli scivoli sono di noce e la rampa
   * d'uscita d'acero chiaro, con una luce calda sotto l'arco: è da lì che arrivano i dadi.
   */
  private costruisciTorre(noce: THREE.MeshStandardMaterial): void {
    const t = misureTorre(this.cfg);
    const B = this.cfg.vassoio.sponda;
    const P = this.cfg.torre.parete;
    const scatola = (xa: number, xb: number, ya: number, yb: number, za: number, zb: number) => {
      const g = scatolaInCentimetri(xb - xa, yb - ya, zb - za, xa + 2 * za + ya);
      g.translate((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
      this.aggiungi(g, noce, { getta: true, riceve: true });
    };
    // Le pareti di fuori affondano nella cornice quanto il suo spigolo tondo, perché sotto non resti una fessura.
    const piede = B - VASSOIO.smusso;
    scatola(t.x0 - P, t.x1 + P, piede, t.alta, t.z0 - P, t.z0);
    scatola(t.x0 - P, t.x0, piede, t.alta, t.z0, t.z2);
    scatola(t.x1, t.x1 + P, piede, t.alta, t.z0, t.z2);
    scatola(t.x0, t.x1, t.arco, t.alta, t.z1, t.z2);

    // Il campo delle targhe è lo stesso noce, più scuro; i filetti sono l'ottone del vassoio.
    const campo = noce.clone();
    campo.color.set(0xa48e7c);
    const veste = { noce, campo, ottone: materialeOttone() };
    for (const pezzo of pezziDellaFacciata(t, P, piede)) this.aggiungi(pezzo.geometria, veste[pezzo.materiale], { getta: pezzo.materiale === 'noce', riceve: true });

    const acero = new THREE.MeshStandardMaterial({ color: 0xdcc296, bumpMap: noce.bumpMap, bumpScale: 0.35, roughnessMap: noce.roughnessMap, roughness: 0.9, metalness: 0 });
    const profili = [...t.scivoli.map((profilo) => ({ profilo, materiale: noce })), { profilo: t.rampa, materiale: acero }];
    for (const { profilo, materiale } of profili) {
      // Il profilo sta nel piano z-y: la forma si estrude lungo il suo asse e si gira per il largo.
      const forma = new THREE.Shape(profilo.map(([z, y]) => new THREE.Vector2(z, Math.max(y, 0))));
      const g = new THREE.ExtrudeGeometry(forma, { depth: t.x1 - t.x0, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      g.translate(t.x1, 0, 0);
      this.aggiungi(g, materiale, { getta: true, riceve: true });
    }
    const brace = new THREE.PointLight(0xffc27a, 26, 15, 2);
    brace.position.set(0, t.arco * 0.62, (t.z0 + t.z1) / 2 + 1.5);
    this.scena.add(brace);
    // La lampada sta sopra la corte e prende la facciata di striscio: una seconda luce, da davanti, la fa leggere.
    const diFronte = new THREE.SpotLight(0xffcf9c, 3.4, 0, 0.5, 0.9, 0);
    diFronte.position.set(-4, 28, t.z2 + 40);
    diFronte.target.position.set(0, t.arco + 5, t.z2);
    this.scena.add(diFronte, diFronte.target);
  }

  /**
   * La lampada calda sopra il tavolo fa la pozza di luce e le ombre morbide; il cielo della stanza
   * schiarisce appena le ombre; una luce fredda da dietro stacca il profilo dei dadi dal fondo scuro.
   */
  private accendiLuci(): void {
    this.scena.add(this.luci);
    this.luci.add(new THREE.HemisphereLight(0x6a4a32, 0x0b0806, 0.55));
    const lampada = new THREE.SpotLight(0xffd2a0, 4.2, 0, 0.6, 0.75, 0);
    lampada.position.set(-10, 52, 16);
    lampada.target.position.set(0, 0, 0);
    lampada.castShadow = true;
    lampada.shadow.mapSize.set(2048, 2048);
    lampada.shadow.camera.near = 25;
    lampada.shadow.camera.far = 90;
    lampada.shadow.bias = -0.0004;
    lampada.shadow.normalBias = 0.02;
    lampada.shadow.radius = 5;
    this.luci.add(lampada, lampada.target);
    const profilo = new THREE.DirectionalLight(0x7090c8, 0.55);
    profilo.position.set(16, 18, -40);
    this.luci.add(profilo);
  }

  /**
   * Camera fissa, inclinata di 40 gradi, dalla parte di chi tira, alla distanza minima che tiene nel
   * riquadro la corte con la sua cornice e la facciata della torre fino alla targa del totale. Nelle tele
   * larghe il resto della torre sale oltre il bordo, che taglia il marcapiano. Dove in altezza avanza posto
   * (le tele strette e alte) torre e corte si mettono insieme a metà tela: il riquadro della camera si
   * sposta, e lei resta puntata al centro della corte. In fondo dice al foglio di stile dove cade la targa.
   */
  private adatta(): void {
    const w = this.contenitore.clientWidth;
    const h = this.contenitore.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.clearViewOffset();
    const S = this.cfg.vassoio.sponda;
    const T = VASSOIO.larga;
    const corte = misureCorte(this.cfg);
    const torre = misureTorre(this.cfg);
    // Quello che deve stare nel riquadro: la corte con la sua cornice e la facciata fino alla targa compresa.
    const angoli: THREE.Vector3[] = [];
    for (const x of [corte.x0 - T, corte.x1 + T]) {
      for (const y of [-VASSOIO.base, S]) angoli.push(new THREE.Vector3(x, y, corte.z1 + T));
      for (const y of [0, quotaDiTaglio(torre)]) angoli.push(new THREE.Vector3(x, y, corte.z0));
    }
    const orlo = [torre.x0, torre.x1].map((x) => new THREE.Vector3(x, torre.alta, torre.z0));
    const targa = campoDellaTarga(torre);
    const centro = new THREE.Vector3(0, 0, (corte.z0 + corte.z1 + T) / 2);
    this.luci.position.copy(centro);
    // In coordinate normalizzate: la facciata arriva al bordo in alto, sotto la corte resta il margine.
    const cima = 1;
    const fondo = -RIEMPIMENTO.y;
    const s = Math.sin(INCLINAZIONE);
    const dir = new THREE.Vector3(0, Math.cos(INCLINAZIONE), s);
    /** Se corte e arco stanno nel riquadro da questa distanza, e di quanto si sposta l'inquadratura. */
    const prova = (distanza: number) => {
      this.camera.position.copy(dir).multiplyScalar(distanza).add(centro);
      this.camera.lookAt(centro);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
      let alto = -Infinity;
      let basso = Infinity;
      let largo = 0;
      for (const a of angoli) {
        const p = a.clone().project(this.camera);
        alto = Math.max(alto, p.y);
        basso = Math.min(basso, p.y);
        largo = Math.max(largo, Math.abs(p.x));
      }
      const cimaTorre = Math.max(...orlo.map((a) => a.clone().project(this.camera).y));
      // Torre e corte a metà tela, fin dove la corte resta sopra il margine e la targa dentro il riquadro.
      const voluto = -(cimaTorre + basso) / 2;
      return { entra: largo <= RIEMPIMENTO.x && alto - basso <= cima - fondo, spostamento: Math.min(Math.max(voluto, fondo - basso), cima - alto) };
    };
    let vicino = 5;
    let lontano = 500;
    for (let k = 0; k < 40; k++) {
      const mezzo = (vicino + lontano) / 2;
      if (prova(mezzo).entra) lontano = mezzo;
      else vicino = mezzo;
    }
    const { spostamento } = prova(lontano);
    // Il riquadro sale di tanto quanto la corte deve scendere: mezza altezza di tela per unità normalizzata.
    if (spostamento !== 0) this.camera.setViewOffset(w, h, 0, (spostamento * h) / 2, w, h);
    // Dove cade sulla tela il campo della targa, in pixel: il foglio di stile ci scrive sopra il totale.
    const inPixel = (x: number, y: number) => {
      const p = new THREE.Vector3(x, y, targa.z).project(this.camera);
      return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
    };
    const alto = inPixel(targa.x + targa.largo / 2, targa.y + targa.alto / 2);
    const basso = inPixel(targa.x - targa.largo / 2, targa.y - targa.alto / 2);
    const stile = (this.contenitore.parentElement ?? this.contenitore).style;
    stile.setProperty('--targa-x', `${((alto.x + basso.x) / 2).toFixed(1)}px`);
    stile.setProperty('--targa-y', `${((alto.y + basso.y) / 2).toFixed(1)}px`);
    stile.setProperty('--targa-larga', `${Math.abs(alto.x - basso.x).toFixed(1)}px`);
    stile.setProperty('--targa-alta', `${Math.abs(basso.y - alto.y).toFixed(1)}px`);
    this.richiediDisegno();
  }

  /**
   * Mesh nuove per i dadi di un tiro, nella serie di chi tira (chi gioca al tavolo, o il master); quelle di
   * prima escono di scena, e il lampo di prima si spegne.
   */
  impostaDadi(specs: readonly SpecDado[], di: 'giocatore' | 'master' = 'giocatore'): void {
    this.fermaLampo();
    for (const d of this.dadi) this.scena.remove(d.mesh);
    const serie: Serie = di === 'master' ? 'master' : this.serieDelGiocatore;
    this.dadi = specs.map((spec) => {
      const mesh = new THREE.Mesh(geometriaDado(spec.forma), materialeDado(spec.forma, spec.ruolo, 'normale', serie));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scena.add(mesh);
      return { mesh, spec, serie, tono: 'normale' };
    });
  }

  posa(indice: number, p: V3, q: Quat): void {
    const d = this.dadi[indice];
    if (!d) return;
    // Sopra il coperchio stanno i dadi che aspettano la loro ondata: non sono ancora in gioco.
    d.mesh.visible = p[1] <= this.cfg.vassoio.coperchio;
    d.mesh.position.set(p[0], p[1], p[2]);
    d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }

  tono(indice: number, tono: Tono): void {
    const d = this.dadi[indice];
    if (!d) return;
    d.tono = tono;
    d.mesh.material = materialeDado(d.spec.forma, d.spec.ruolo, tono, d.serie);
  }

  /**
   * Il lampo del 20 naturale sul dado `indice`: una luce calda sopra il dado e i numeri che si accendono,
   * poi si spengono in poco più di un secondo. Disegna da sé i suoi fotogrammi, quando l'evento del tiro
   * è già partito; un tiro nuovo lo ferma.
   */
  lampo(indice: number): void {
    const d = this.dadi[indice];
    if (!d) return;
    this.fermaLampo();
    const materiale = d.mesh.material as THREE.MeshPhysicalMaterial;
    this.luceLampo.position.copy(d.mesh.position).add(new THREE.Vector3(0, LAMPO.altezza, 0));
    const stato = { materiale, riposo: materiale.emissiveIntensity, inizio: performance.now(), giro: 0 };
    const passo = (ora: number) => {
      if (this.lampoAttivo !== stato) return;
      const t = (ora - stato.inizio) / LAMPO.durata;
      if (t >= 1) {
        this.fermaLampo();
        this.disegna();
        return;
      }
      // Sale in fretta, poi si spegne piano.
      const forza = t < LAMPO.salita ? Math.max(0, t) / LAMPO.salita : Math.pow(1 - (t - LAMPO.salita) / (1 - LAMPO.salita), 2);
      this.luceLampo.intensity = LAMPO.luce * forza;
      materiale.emissiveIntensity = stato.riposo + LAMPO.numeri * forza;
      this.disegna();
      stato.giro = requestAnimationFrame(passo);
    };
    this.lampoAttivo = stato;
    stato.giro = requestAnimationFrame(passo);
  }

  private fermaLampo(): void {
    const l = this.lampoAttivo;
    if (!l) return;
    cancelAnimationFrame(l.giro);
    l.materiale.emissiveIntensity = l.riposo;
    this.luceLampo.intensity = 0;
    this.lampoAttivo = null;
  }

  /**
   * Dove si vedono i dadi, in pixel della pagina, e il punto da cui si legge il risultato: il centro
   * della faccia più alta, o per il d4 il vertice in cima. Per le prove, che ingrandiscono lo scatto lì.
   */
  dadiSulloSchermo(): { x: number; y: number; raggio: number; lettura: { x: number; y: number } }[] {
    const r = this.renderer.domElement.getBoundingClientRect();
    const sulloSchermo = (v: THREE.Vector3) => {
      const c = v.clone().project(this.camera);
      return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
    };
    return this.dadi.map(({ mesh, spec }) => {
      const g = geometria(spec.forma);
      const nelMondo = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]).applyQuaternion(mesh.quaternion).add(mesh.position);
      let punto: THREE.Vector3;
      if (g.letturaInBasso) {
        punto = g.vertici.map(nelMondo).reduce((a, b) => (b.y > a.y ? b : a));
      } else {
        let migliore = 0;
        let alto = -Infinity;
        g.normali.forEach((n, i) => {
          const y = new THREE.Vector3(n[0], n[1], n[2]).applyQuaternion(mesh.quaternion).y;
          if (y > alto) {
            alto = y;
            migliore = i;
          }
        });
        punto = nelMondo(g.centri[migliore]!);
      }
      const centro = sulloSchermo(mesh.position);
      const bordo = sulloSchermo(mesh.position.clone().add(new THREE.Vector3(g.raggio, 0, 0)));
      return { ...centro, raggio: Math.abs(bordo.x - centro.x), lettura: sulloSchermo(punto) };
    });
  }

  disegna(): void {
    this.renderer.render(this.scena, this.camera);
  }

  /** Un fotogramma solo, al prossimo giro del browser. */
  richiediDisegno(): void {
    if (this.disegnoChiesto) return;
    this.disegnoChiesto = true;
    requestAnimationFrame(() => {
      this.disegnoChiesto = false;
      this.disegna();
    });
  }

  libera(): void {
    this.fermaLampo();
    this.osservatore.disconnect();
    for (const d of this.dadi) this.scena.remove(d.mesh);
    this.dadi = [];
    for (const r of this.risorse) r.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
