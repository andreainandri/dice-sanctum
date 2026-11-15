// La scena 3D: il vassoio in noce sul tavolo dello studio, la lampada, la camera fissa e le mesh dei dadi.
// Disegna soltanto quando serve: durante un tiro a ogni fotogramma, da fermo una volta per cambiamento
// (dimensioni, colori).

import * as THREE from 'three';
import { type ConfigFisica } from '../physics/config.ts';
import { type SpecDado } from '../physics/vassoio.ts';
import { FORME, type Ruolo, geometria } from '../shared/dadi.ts';
import { type Quat, type V3 } from '../shared/vettori.ts';
import { TONI, type Tono, geometriaDado, impostaAnisotropia, materialeDado } from './facce.ts';
import { type Trame, ambiente, materialeLegno, materialeOttone, materialeVelluto } from './materiali.ts';

/** Inclinazione della camera dalla verticale. */
const INCLINAZIONE = (40 * Math.PI) / 180;
/** Quanto del riquadro occupa il vassoio, in coordinate normalizzate. */
const RIEMPIMENTO = { x: 0.94, y: 0.9 };
/**
 * La fascia in alto, in pixel, che resta al risultato (totale e naturale): la cornice comincia sotto.
 * Piena da 630 pixel di tela in su; nelle tele più basse cala col totale, che il foglio di stile rimpicciolisce,
 * e non prende mai più di `quotaMassima` dell'altezza.
 */
const FASCIA_RISULTATO = { piena: 126, minima: 86, quotaDellAltezza: 0.2, quotaMassima: 0.4 } as const;
/**
 * Nelle tele basse la fascia pesa di più, e il vassoio centrato lascerebbe vuoto il fondo: lì l'inquadratura
 * scende, e il vassoio si mette a metà fra la fascia e il margine in basso. Nessuna discesa da `nessuna`
 * pixel di tela in su, discesa intera da `intera` in giù, in mezzo una parte.
 */
const TELA_BASSA = { nessuna: 430, intera: 300 } as const;

/**
 * Il vassoio che si vede, in centimetri: soltanto disegno. Altezza e spessore delle sponde stanno nella
 * configurazione, accanto alle misure della fisica; le facce interne delle sponde stanno sui suoi piani.
 */
const VASSOIO = {
  /** Altezza del fondo sopra il tavolo. */
  base: 1.6,
  /** Raggio degli angoli fuori e dentro, visti dall'alto. */
  angoloFuori: 1.2,
  angoloDentro: 0.3,
  /** Lo smusso che arrotonda gli spigoli in cima e in fondo. */
  smusso: 0.3,
  /** Il filo d'ottone sulla cima, a questa distanza dal bordo interno, e largo tanto. */
  filoDistanza: 0.95,
  filoLarghezza: 0.15,
} as const;

/**
 * Il lampo del 20 naturale: quanto dura, la luce calda sopra il dado (forza, colore, portata in centimetri,
 * altezza sul centro del dado) e quanto si accendono i suoi numeri.
 */
const LAMPO = { durata: 1100, salita: 0.12, luce: 150, colore: 0xffc46a, portata: 9, altezza: 2.6, numeri: 3.5 } as const;

/** Un rettangolo dagli angoli arrotondati, centrato nell'origine, come forma o come foro. */
function rettangolo<T extends THREE.Path>(p: T, l: number, a: number, r: number): T {
  const x = l / 2;
  const y = a / 2;
  p.moveTo(-x + r, -y);
  p.lineTo(x - r, -y);
  p.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
  p.lineTo(x, y - r);
  p.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
  p.lineTo(-x + r, y);
  p.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
  p.lineTo(-x, -y + r);
  p.absarc(-x + r, -y + r, r, Math.PI, (3 * Math.PI) / 2, false);
  return p;
}

/**
 * Coordinate di trama in centimetri per una cornice: la venatura corre lungo ogni sponda, come nelle
 * cornici coi pezzi tagliati a 45 gradi. Ogni triangolo prende il verso della sponda in cui cade il suo
 * centro, così dentro un triangolo la trama non si stira; il cambio di verso cade agli angoli.
 */
function uvCornice(l: number, a: number): THREE.UVGenerator {
  const sulLato = (x: number, y: number) => Math.abs(x) - l / 2 > Math.abs(y) - a / 2;
  return {
    generateTopUV(_g, v, ia, ib, ic) {
      const ids = [ia, ib, ic];
      const cx = ids.reduce((s, i) => s + v[i * 3]!, 0) / 3;
      const cy = ids.reduce((s, i) => s + v[i * 3 + 1]!, 0) / 3;
      const lato = sulLato(cx, cy);
      return ids.map((i) => (lato ? new THREE.Vector2(v[i * 3 + 1]!, v[i * 3]!) : new THREE.Vector2(v[i * 3]!, v[i * 3 + 1]!)));
    },
    generateSideWallUV(_g, v, ia, ib, ic, id) {
      const ids = [ia, ib, ic, id];
      const cx = ids.reduce((s, i) => s + v[i * 3]!, 0) / 4;
      const cy = ids.reduce((s, i) => s + v[i * 3 + 1]!, 0) / 4;
      const lato = sulLato(cx, cy);
      return ids.map((i) => new THREE.Vector2(v[i * 3 + (lato ? 1 : 0)]!, v[i * 3 + 2]!));
    },
  };
}

/** Un anello piatto estruso in verticale: dal piano y = `da`, alto `alto`, con gli spigoli smussati. */
function anello(fuori: [number, number, number], dentro: [number, number, number], da: number, alto: number, smusso: number): THREE.BufferGeometry {
  const forma = rettangolo(new THREE.Shape(), ...fuori);
  forma.holes.push(rettangolo(new THREE.Path(), ...dentro));
  const bevel = smusso > 0;
  const g = new THREE.ExtrudeGeometry(forma, {
    depth: bevel ? alto - 2 * smusso : alto,
    bevelEnabled: bevel,
    bevelThickness: smusso,
    bevelSize: smusso,
    bevelOffset: -smusso,
    bevelSegments: 4,
    curveSegments: 6,
    UVGenerator: uvCornice(dentro[0], dentro[1]),
  });
  // L'estrusione va lungo z: la si gira in verticale e la si posa da `da` in su.
  g.rotateX(-Math.PI / 2);
  g.translate(0, da + (bevel ? smusso : 0), 0);
  return g;
}

/** Coordinate di trama in centimetri dal centro del piano, come quelle della cornice. */
function uvInCentimetri(g: THREE.BufferGeometry, l: number, a: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * l, (uv.getY(i) - 0.5) * a);
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
  private dadi: { mesh: THREE.Mesh; spec: SpecDado }[] = [];
  private disegnoChiesto = false;
  /**
   * La luce del lampo sta sempre in scena, spenta: aggiungerla al momento del 20 cambierebbe il numero
   * delle luci e farebbe ricompilare ogni materiale proprio in quel fotogramma.
   */
  private readonly luceLampo = new THREE.PointLight(LAMPO.colore, 0, LAMPO.portata, 2);
  /** Lampada, cielo e luce di profilo: girano insieme alla camera quando la veduta cambia lato. */
  private readonly luci = new THREE.Group();
  private lampoAttivo: { materiale: THREE.MeshPhysicalMaterial; riposo: number; inizio: number; giro: number } | null = null;

  constructor(contenitore: HTMLElement, cfg: ConfigFisica, trame: Trame) {
    this.contenitore = contenitore;
    this.cfg = cfg;
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
   * Dipinge subito le facce di tutti i dadi e compila i materiali: senza, il primo tiro di ogni
   * tipo di dado perdeva un fotogramma da 50 ms mentre la tela andava alla scheda video.
   */
  private prepara(): void {
    const prova: THREE.Mesh[] = [];
    for (const forma of FORME) {
      const ruoli: Ruolo[] = forma === 'd10' ? ['semplice', 'decine', 'unita'] : ['semplice'];
      for (const ruolo of ruoli) {
        for (const tono of TONI) {
          const m = new THREE.Mesh(geometriaDado(forma, ruolo), materialeDado(forma, ruolo, tono));
          m.castShadow = true;
          prova.push(m);
          this.scena.add(m);
        }
        const m = materialeDado(forma, ruolo, 'normale');
        for (const t of [m.map, m.roughnessMap, m.emissiveMap]) if (t) this.renderer.initTexture(t);
      }
    }
    this.renderer.compile(this.scena, this.camera);
    for (const m of prova) this.scena.remove(m);
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

  /** Il vassoio intagliato in un pezzo di noce, col fondo di velluto e il filo d'ottone sulla cima, posato sul tavolo. */
  private costruisciVassoio(trame: Trame, aniso: number): void {
    const { larghezza: W, profondita: D, sponda: S, spessore: T } = this.cfg.vassoio;
    const V = VASSOIO;
    const fuori: [number, number, number] = [W + 2 * T, D + 2 * T, V.angoloFuori];
    const dentro: [number, number, number] = [W, D, V.angoloDentro];

    const noce = materialeLegno({
      colore: trame.noce,
      rilievo: trame.noceRilievo,
      ruvidezza: trame.noceRuvidezza,
      lato: 40,
      forzaRilievo: 0.6,
      anisotropia: aniso,
    });
    this.aggiungi(anello(fuori, dentro, -V.base, V.base + S, V.smusso), noce, { getta: true, riceve: true });

    const fd = V.filoDistanza;
    const fl = V.filoLarghezza;
    const filo = anello(
      [W + 2 * (fd + fl), D + 2 * (fd + fl), V.angoloDentro + fd + fl],
      [W + 2 * fd, D + 2 * fd, V.angoloDentro + fd],
      S - 0.01,
      0.03,
      0,
    );
    this.aggiungi(filo, materialeOttone(), { getta: false, riceve: true });

    const piano = new THREE.PlaneGeometry(W, D);
    piano.rotateX(-Math.PI / 2);
    // La foto del velluto ha le proporzioni del fondo e lo copre una volta sola.
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
   * Camera fissa, inclinata di 40 gradi, alla distanza minima che tiene tutto il vassoio nel riquadro.
   * Delle due vedute tiene quella che lo mostra più grande: dal lato lungo, la solita, o dal lato corto,
   * col vassoio per il lungo, che vince nelle tele strette e alte. Le luci girano con la camera: la
   * lampada resta a sinistra, dalla parte di chi guarda. Nelle tele basse l'inquadratura scende (TELA_BASSA)
   * spostando il riquadro della camera, che resta puntata al centro del vassoio.
   */
  private adatta(): void {
    const w = this.contenitore.clientWidth;
    const h = this.contenitore.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.clearViewOffset();
    const { larghezza: W, profondita: D, sponda: S, spessore: T } = this.cfg.vassoio;
    const angoli: THREE.Vector3[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [-VASSOIO.base, S]) angoli.push(new THREE.Vector3(sx * (W / 2 + T), y, sz * (D / 2 + T)));
      }
    }
    const f = FASCIA_RISULTATO;
    const minima = Math.min(f.minima, Math.round(f.quotaMassima * h));
    const fascia = Math.min(f.piena, Math.max(minima, Math.round(f.quotaDellAltezza * h)));
    // In coordinate normalizzate: dove finisce la fascia e dove comincia il margine in basso.
    const cima = Math.min(RIEMPIMENTO.y, 1 - (2 * fascia) / h);
    const fondo = -RIEMPIMENTO.y;
    const discesa = Math.min(1, Math.max(0, (TELA_BASSA.nessuna - h) / (TELA_BASSA.nessuna - TELA_BASSA.intera)));
    const metti = (dir: THREE.Vector3, distanza: number) => {
      this.camera.position.copy(dir).multiplyScalar(distanza);
      this.camera.lookAt(0, 0, 0);
      this.camera.updateMatrixWorld();
      this.camera.updateProjectionMatrix();
    };
    /** Se il vassoio sta nel riquadro da questa distanza, e di quanto scende l'inquadratura. */
    const prova = (dir: THREE.Vector3, distanza: number) => {
      metti(dir, distanza);
      let alto = -Infinity;
      let basso = Infinity;
      let largo = 0;
      for (const a of angoli) {
        const p = a.clone().project(this.camera);
        alto = Math.max(alto, p.y);
        basso = Math.min(basso, p.y);
        largo = Math.max(largo, Math.abs(p.x));
      }
      const spostamento = discesa * ((cima + fondo) / 2 - (alto + basso) / 2);
      return { entra: largo <= RIEMPIMENTO.x && alto + spostamento <= cima && basso + spostamento >= fondo, spostamento };
    };
    const veduta = (azimut: number) => {
      const s = Math.sin(INCLINAZIONE);
      const dir = new THREE.Vector3(Math.sin(azimut) * s, Math.cos(INCLINAZIONE), Math.cos(azimut) * s);
      let vicino = 5;
      let lontano = 500;
      for (let k = 0; k < 40; k++) {
        const mezzo = (vicino + lontano) / 2;
        if (prova(dir, mezzo).entra) lontano = mezzo;
        else vicino = mezzo;
      }
      return { azimut, dir, distanza: lontano };
    };
    const lunga = veduta(0);
    const corta = veduta(Math.PI / 2);
    // Il lato corto soltanto con un guadagno vero: vicino alla parità la veduta non salta avanti e indietro.
    const scelta = corta.distanza < lunga.distanza * 0.97 ? corta : lunga;
    this.luci.rotation.y = scelta.azimut;
    const { spostamento } = prova(scelta.dir, scelta.distanza);
    // Il riquadro sale di tanto quanto il vassoio deve scendere: mezza altezza di tela per unità normalizzata.
    if (spostamento !== 0) this.camera.setViewOffset(w, h, 0, (spostamento * h) / 2, w, h);
    this.richiediDisegno();
  }

  /** Mesh nuove per i dadi di un tiro; quelle di prima escono di scena, e il lampo di prima si spegne. */
  impostaDadi(specs: readonly SpecDado[]): void {
    this.fermaLampo();
    for (const d of this.dadi) this.scena.remove(d.mesh);
    this.dadi = specs.map((spec) => {
      const mesh = new THREE.Mesh(geometriaDado(spec.forma, spec.ruolo), materialeDado(spec.forma, spec.ruolo, 'normale'));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scena.add(mesh);
      return { mesh, spec };
    });
  }

  posa(indice: number, p: V3, q: Quat): void {
    const d = this.dadi[indice];
    if (!d) return;
    d.mesh.position.set(p[0], p[1], p[2]);
    d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }

  tono(indice: number, tono: Tono): void {
    const d = this.dadi[indice];
    if (d) d.mesh.material = materialeDado(d.spec.forma, d.spec.ruolo, tono);
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
