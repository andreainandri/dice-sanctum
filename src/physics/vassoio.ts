// Il vassoio: un mondo Rapier con la corte (fondo, sponde, coperchio invisibile), la torre dei dadi
// sul lato di fondo e i dadi di un tiro, che cadono nella torre a ondate ed escono a rotolare nella corte.
// Lo stesso codice gira nel browser (un passo alla volta, dentro i fotogrammi) e in Node
// (le prove di equità, a ciclo continuo).

import RAPIER from '@dimforge/rapier3d-compat';
import { type Forma, type Ruolo, geometria, valoreDaLettura } from '../shared/dadi.ts';
import { leggi } from '../shared/lettura.ts';
import { tr } from '../shared/lingua.ts';
import { rotazioniDelSolido } from '../shared/simmetrie.ts';
import { type Quat, type V3, prodotto } from '../shared/vettori.ts';
import { type Fonte, direzioneUniforme, intero, intervallo, mescola, quatUniforme } from './casuale.ts';
import { FISICA, type ConfigFisica } from './config.ts';
import { type MisureTorre, type PuntoProfilo, celleDellaBocca, misureTorre } from './torre.ts';

export type Rapier = typeof RAPIER;

let caricamento: Promise<Rapier> | null = null;
/** Rapier compat porta il WASM dentro il modulo: va inizializzato una volta. */
export function caricaRapier(): Promise<Rapier> {
  caricamento ??= RAPIER.init().then(() => RAPIER);
  return caricamento;
}

export interface SpecDado {
  forma: Forma;
  ruolo: Ruolo;
}

export type MotivoRitiro = 'storto' | 'uscito' | 'non si ferma' | 'nella torre';

/** Come parte un dado: lo decide il caso al momento del lancio, e vale quando tocca alla sua ondata. */
export interface Partenza {
  p: V3;
  q: Quat;
  /** Velocità e rotazione al rilascio. */
  v: V3;
  w: V3;
}

export interface DadoFisico {
  readonly indice: number;
  /**
   * La rotazione di simmetria che in questo lancio lega i numeri al solido: una a caso fra quelle che
   * portano il dado su sé stesso. Il solutore di Rapier tratta vertici e pezzi del collisore in un ordine
   * fisso, e certe facce del solido finiscono in alto un po' più spesso (il d12 fino al 4%, misurato su
   * 100.000 lanci): così ogni volta portano un numero diverso, e ogni numero esce quanto gli altri.
   */
  readonly giro: Quat;
  readonly spec: SpecDado;
  readonly corpo: RAPIER.RigidBody;
  ritiri: number;
  /** Da quanto il dado sta sotto le soglie di quiete, in secondi. */
  tempoFermo: number;
  /** Da quanto il dado si muove senza essersi mai fermato, in secondi. */
  inMovimentoDa: number;
  /** Quanti secondi mancano alla sua ondata; zero quando è in gioco. */
  attesa: number;
  /** La partenza che lo aspetta, finché è in attesa. */
  partenza: Partenza | null;
}

export interface LetturaFinale {
  indice: number;
  spec: SpecDado;
  faccia: number;
  /** Il numero della tabella (d10: 0..9). */
  lettura: number;
  /** Il valore del dado (d10 semplice: 1..10; decine: 0..90). */
  valore: number;
  inclinazione: number;
  ritiri: number;
}

export type StatoLancio = 'in corso' | 'fermo' | 'fallito';

export interface OpzioniLancio {
  /** Solo per le prove: decide al posto dell'inclinazione se un dado fermo è storto. */
  controlloStorto?: (indice: number, inclinazione: number) => boolean;
  /** Chiamata a ogni ritiro, prima che il dado riparta. */
  alRitiro?: (indice: number, motivo: MotivoRitiro, ritiri: number) => void;
  /** Chiamata quando un dado che aspettava la sua ondata cade nella torre: in quel passo salta di posto. */
  alRilascio?: (indice: number) => void;
}

/** La volta di troppo, per numero di ritiri ammessi: con tre ritiri il tiro fallisce alla quarta. */
const VOLTE = [
  { it: 'prima', en: 'first' },
  { it: 'seconda', en: 'second' },
  { it: 'terza', en: 'third' },
  { it: 'quarta', en: 'fourth' },
  { it: 'quinta', en: 'fifth' },
] as const;

/** Che cosa ha fatto un dado da ritirare, nelle frasi dopo il suo nome. */
export function nomeMotivo(m: MotivoRitiro): string {
  if (m === 'storto') return tr({ it: 'si è fermato storto', en: 'came to rest tilted' });
  if (m === 'uscito') return tr({ it: 'è uscito dal vassoio', en: 'left the tray' });
  if (m === 'nella torre') return tr({ it: 'è rimasto nella torre', en: 'stayed in the tower' });
  return tr({ it: 'non si è fermato', en: 'did not come to rest' });
}

/** Il nome di un dado nelle frasi: «il d20», «il d10 delle decine». */
export function nomeDado(spec: SpecDado): string {
  if (spec.ruolo === 'decine') return tr({ it: 'il d10 delle decine', en: 'the tens d10' });
  if (spec.ruolo === 'unita') return tr({ it: 'il d10 delle unità', en: 'the units d10' });
  return tr({ it: `il ${spec.forma}`, en: `the ${spec.forma}` });
}

const pezziPerForma = new Map<Forma, Float32Array[]>();
/**
 * I pezzi convessi del collisore di un dado. Rapier costruisce il contatto di una faccia con al più
 * quattro dei suoi vertici: sui pentagoni del d12 ne restava fuori sempre uno, il dado si ribaltava
 * più facilmente da quel lato e le facce smettevano di essere equiprobabili (fino al 6% di scarto).
 * Il d12 si compone allora come nella costruzione di Euclide (Elementi XIII.17): un cubo con un tetto
 * su ogni faccia. Ogni pezzo ha facce di tre o quattro vertici, ogni pentagono è il trapezio di un
 * tetto più il triangolo del tetto accanto, e l'insieme ha le dodici rotazioni del tetraedro, che
 * portano ogni faccia su ogni altra. Gli altri dadi hanno facce di tre o quattro vertici: un pezzo solo.
 * I pezzi toccano soltanto il fondo; contro sponde, coperchio e altri dadi il d12 usa il guscio intero
 * (vedi GRUPPI).
 */
export function pezziDelDado(forma: Forma): Float32Array[] {
  let pezzi = pezziPerForma.get(forma);
  if (pezzi) return pezzi;
  const vertici = geometria(forma).vertici;
  if (forma !== 'd12') {
    pezzi = [new Float32Array(vertici.flat())];
  } else {
    // Mezzo spigolo del cubo inscritto: i vertici del cubo hanno le tre coordinate uguali in modulo.
    const s = Math.min(...vertici.map((v) => Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]))));
    const eps = 1e-6 * s;
    const cubo = vertici.filter((v) => v.every((c) => Math.abs(Math.abs(c) - s) < eps));
    const tetti: V3[][] = [];
    for (const asse of [0, 1, 2] as const) {
      for (const segno of [1, -1]) tetti.push(vertici.filter((v) => segno * v[asse] >= s - eps));
    }
    if (cubo.length !== 8 || tetti.some((t) => t.length !== 6)) throw new Error('d12: scomposizione in cubo e tetti non riuscita');
    pezzi = [cubo, ...tetti].map((p) => new Float32Array(p.flat()));
  }
  pezziPerForma.set(forma, pezzi);
  return pezzi;
}

/**
 * Chi tocca chi, nei gruppi di collisione di Rapier (appartenenza nei 16 bit alti, filtro nei bassi).
 * I sette pezzi del d12 servono soltanto contro il fondo, dove il dado si appoggia e si legge; contro
 * sponde, coperchio e altri dadi basta il guscio intero, che costa un settimo. Coi pezzi dappertutto
 * un passo con trenta d12 costava 11 ms in Node; con questi gruppi, quattro iterazioni del solutore e
 * senza CCD costa 1,3. Nel browser la stessa fisica va circa tre volte più piano, e a 60 fotogrammi
 * due passi devono stare in 16 ms insieme al disegno.
 */
const FONDO = 1;
const DADO = 2;
const GUSCIO_D12 = 4;
const PEZZI_D12 = 8;
const SPONDA = 16;
const gruppi = (appartiene: number, tocca: number) => (appartiene << 16) | tocca;
const GRUPPI = {
  fondo: gruppi(FONDO, DADO | PEZZI_D12),
  sponda: gruppi(SPONDA, DADO | GUSCIO_D12),
  dado: gruppi(DADO, FONDO | SPONDA | DADO | GUSCIO_D12),
  guscioD12: gruppi(GUSCIO_D12, SPONDA | DADO | GUSCIO_D12),
  pezziD12: gruppi(PEZZI_D12, FONDO),
} as const;

export class Vassoio {
  readonly world: RAPIER.World;
  readonly cfg: ConfigFisica;
  /** Il piano del fondo, per le prove sui contatti. */
  readonly fondo: RAPIER.Collider;
  readonly torre: MisureTorre;
  private readonly R: Rapier;
  private dadiAttuali: DadoFisico[] = [];
  private lancioAttuale: Lancio | null = null;

  constructor(R: Rapier, cfg: ConfigFisica = FISICA) {
    this.R = R;
    this.cfg = cfg;
    this.world = new R.World({ x: 0, y: -cfg.gravita, z: 0 });
    this.world.timestep = cfg.passo;
    this.world.lengthUnit = cfg.unitaPerMetro;
    this.world.integrationParameters.numSolverIterations = cfg.iterazioniSolutore;
    this.world.integrationParameters.normalizedPredictionDistance = cfg.previsione / cfg.unitaPerMetro;
    this.torre = misureTorre(cfg);
    this.fondo = this.costruisciVassoio();
  }

  /**
   * Fondo, sponde e coperchio sono piani infiniti: contro un piano Rapier tocca tutti i vertici
   * della faccia appoggiata, mentre contro una scatola aggiunge un punto in più e ne scarta uno
   * per restare a quattro (il d10 perdeva un angolo su tre facce). I dadi stanno dentro la scatola
   * che i sei piani chiudono; chi ne esce lo vede `dentro()`.
   */
  private costruisciVassoio(): RAPIER.Collider {
    const { larghezza: W, profondita: D, coperchio: H } = this.cfg.vassoio;
    const R = this.R;
    const fisso = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const piano = (normale: V3, punto: V3, attrito: number, rimbalzo: number, gruppo: number) =>
      this.world.createCollider(
        new R.ColliderDesc(new R.HalfSpace({ x: normale[0], y: normale[1], z: normale[2] }))
          .setTranslation(punto[0], punto[1], punto[2])
          .setFriction(attrito)
          .setRestitution(rimbalzo)
          .setCollisionGroups(gruppo),
        fisso,
      );
    const { attrito: af, rimbalzo: rf } = this.cfg.fondo;
    const { attrito: as, rimbalzo: rs } = this.cfg.sponde;
    const fondo = piano([0, 1, 0], [0, 0, 0], af, rf, GRUPPI.fondo);
    // Le sponde fisiche arrivano al coperchio; quelle che si vedono sono più basse.
    piano([1, 0, 0], [-W / 2, 0, 0], as, rs, GRUPPI.sponda);
    piano([-1, 0, 0], [W / 2, 0, 0], as, rs, GRUPPI.sponda);
    piano([0, 0, 1], [0, 0, -D / 2], as, rs, GRUPPI.sponda);
    piano([0, 0, -1], [0, 0, D / 2], as, rs, GRUPPI.sponda);
    piano([0, -1, 0], [0, H, 0], as, rs, GRUPPI.sponda);
    this.costruisciTorre(fisso);
    return fondo;
  }

  /**
   * La torre: la parete verso la corte, sopra l'arco, è una scatola; gli scivoli e la rampa d'uscita sono
   * cunei. Contro scatole e cunei Rapier appoggia una faccia con al più quattro punti e ne scarta qualcuno:
   * qui non conta, perché nella torre nessun dado si ferma (chi ci resta si ritira) e la lettura si fa sul
   * fondo della corte, che è un piano. La parete sale fino al coperchio: sopra l'orlo non si vede, e tiene
   * in canna i dadi che cadono.
   */
  private costruisciTorre(fisso: RAPIER.RigidBody): void {
    const R = this.R;
    const T = this.cfg.torre;
    const H = this.cfg.vassoio.coperchio;
    const { x0, x1, z1, z2, arco, scivoli, rampa } = this.torre;
    const posa = (desc: RAPIER.ColliderDesc) =>
      this.world.createCollider(desc.setFriction(T.attrito).setRestitution(T.rimbalzo).setCollisionGroups(GRUPPI.sponda), fisso);
    /** Un profilo nel piano z-y, lungo quanto la torre è larga. */
    const cuneo = (profilo: readonly PuntoProfilo[]) => {
      const punti: number[] = [];
      for (const [z, y] of profilo) punti.push(x0, y, z, x1, y, z);
      const desc = R.ColliderDesc.convexHull(new Float32Array(punti));
      if (!desc) throw new Error('torre: cuneo non costruibile');
      posa(desc);
    };
    posa(R.ColliderDesc.cuboid((x1 - x0) / 2, (H - arco) / 2, (z2 - z1) / 2).setTranslation((x0 + x1) / 2, (arco + H) / 2, (z1 + z2) / 2));
    for (const s of scivoli) cuneo(s);
    cuneo(rampa);
  }

  get dadi(): readonly DadoFisico[] {
    return this.dadiAttuali;
  }

  get lancio(): Lancio | null {
    return this.lancioAttuale;
  }

  /** Toglie i dadi dal vassoio. */
  pulisci(): void {
    for (const d of this.dadiAttuali) this.world.removeRigidBody(d.corpo);
    this.dadiAttuali = [];
    this.lancioAttuale = null;
  }

  /** Lancia un tiro nuovo: i dadi di prima escono dal vassoio. */
  lancia(specs: readonly SpecDado[], fonte: Fonte, opzioni: OpzioniLancio = {}): Lancio {
    this.pulisci();
    const R = this.R;
    const partenze = this.partenze(fonte, specs.length);
    this.dadiAttuali = specs.map((spec, indice) => {
      const desc = R.RigidBodyDesc.dynamic()
        .setLinearDamping(this.cfg.dado.smorzamentoLineare)
        .setAngularDamping(this.cfg.dado.smorzamentoAngolare)
        // Senza CCD: un piano non si attraversa, le pareti e gli scivoli della torre sono spessi più di
        // quanto un dado percorre in un passo, e fra dado e dado bastano i contatti anticipati di Rapier.
        .setCanSleep(false);
      const corpo = this.world.createRigidBody(desc);
      const collisore = (punti: Float32Array, densita: number, gruppo: number) => {
        const coll = R.ColliderDesc.convexHull(punti);
        if (!coll) throw new Error(`guscio convesso non costruibile per ${spec.forma}`);
        coll
          .setDensity(densita)
          .setFriction(this.cfg.dado.attrito)
          .setRestitution(this.cfg.dado.rimbalzo)
          .setCollisionGroups(gruppo);
        this.world.createCollider(coll, corpo);
      };
      const pezzi = pezziDelDado(spec.forma);
      if (pezzi.length === 1) {
        collisore(pezzi[0]!, this.cfg.dado.densita, GRUPPI.dado);
      } else {
        // La massa sta nei pezzi, che riempiono il dado senza sovrapporsi; il guscio non pesa.
        for (const pezzo of pezzi) collisore(pezzo, this.cfg.dado.densita, GRUPPI.pezziD12);
        collisore(new Float32Array(geometria(spec.forma).vertici.flat()), 0, GRUPPI.guscioD12);
      }
      const giri = rotazioniDelSolido(spec.forma);
      const giro = giri[intero(fonte, giri.length)]!;
      const dado: DadoFisico = { indice, giro, spec, corpo, ritiri: 0, tempoFermo: 0, inMovimentoDa: 0, attesa: 0, partenza: null };
      this.metti(dado, partenze[indice]!);
      return dado;
    });
    this.lancioAttuale = new Lancio(this, fonte, opzioni);
    return this.lancioAttuale;
  }

  /** I centri delle celle della bocca, alla quota da cui i dadi cadono. */
  celleDellaBocca(): V3[] {
    const L = this.cfg.lancio;
    const quota = this.torre.alta + L.sopraLOrlo;
    return celleDellaBocca(this.torre, L.passoGriglia, L.gioco).map(([x, z]): V3 => [x, quota, z]);
  }

  /**
   * Le partenze di `quanti` dadi, a ondate: in ogni ondata un dado per cella della bocca, e fra un'ondata
   * e la seguente il tempo che serve alla prima per sgombrare. Posto, ondata, orientamento (uniforme su
   * tutte le rotazioni), velocità e rotazione li sceglie il caso, e nessuno dipende da com'è girato il dado.
   */
  partenze(fonte: Fonte, quanti: number): { partenza: Partenza; attesa: number }[] {
    const L = this.cfg.lancio;
    const celle = this.celleDellaBocca();
    const onda = Math.max(1, Math.min(L.onda, celle.length));
    const tutte: { partenza: Partenza; attesa: number }[] = [];
    for (let i = 0; i < quanti; i += onda) {
      const libere = mescola(fonte, [...celle]);
      for (let k = 0; k < onda && i + k < quanti; k++) {
        const c = libere[k]!;
        const verso = 2 * Math.PI * fonte.uniforme();
        const deriva = L.deriva * fonte.uniforme();
        const asse = direzioneUniforme(fonte);
        const giri = intervallo(fonte, L.rotazioneMinima, L.rotazioneMassima);
        tutte.push({
          attesa: (i / onda) * L.intervallo,
          partenza: {
            p: [c[0] + intervallo(fonte, -L.scarto, L.scarto), c[1] + intervallo(fonte, -L.scarto, L.scarto), c[2] + intervallo(fonte, -L.scarto, L.scarto)],
            q: quatUniforme(fonte),
            v: [Math.cos(verso) * deriva, -intervallo(fonte, L.cadutaMinima, L.cadutaMassima), Math.sin(verso) * deriva],
            w: [asse[0] * giri, asse[1] * giri, asse[2] * giri],
          },
        });
      }
    }
    // Chi cade per primo lo decide il caso.
    return mescola(fonte, tutte);
  }

  /**
   * Mette un dado alla sua partenza. Se la sua ondata non è la prima aspetta fermo, fuori dal mondo, più
   * in alto di ogni inquadratura; `avvia` lo fa cadere.
   */
  metti(dado: DadoFisico, come: { partenza: Partenza; attesa: number }): void {
    const { p, q } = come.partenza;
    const c = dado.corpo;
    dado.partenza = come.partenza;
    dado.attesa = come.attesa;
    dado.tempoFermo = 0;
    dado.inMovimentoDa = 0;
    c.setEnabled(false);
    c.setTranslation({ x: p[0], y: p[1] + this.cfg.lancio.parcheggio, z: p[2] }, false);
    c.setRotation(q, false);
    c.setLinvel({ x: 0, y: 0, z: 0 }, false);
    c.setAngvel({ x: 0, y: 0, z: 0 }, false);
    if (come.attesa <= 0) this.avvia(dado);
  }

  /** Tocca alla sua ondata: il dado entra nel mondo alla sua partenza e cade nella torre. */
  avvia(dado: DadoFisico): void {
    const come = dado.partenza;
    if (!come) return;
    const c = dado.corpo;
    c.setEnabled(true);
    c.setTranslation({ x: come.p[0], y: come.p[1], z: come.p[2] }, true);
    c.setRotation(come.q, true);
    c.setLinvel({ x: come.v[0], y: come.v[1], z: come.v[2] }, true);
    c.setAngvel({ x: come.w[0], y: come.w[1], z: come.w[2] }, true);
    c.resetForces(true);
    c.resetTorques(true);
    dado.partenza = null;
    dado.attesa = 0;
    dado.tempoFermo = 0;
    dado.inMovimentoDa = 0;
  }

  /** Vero se il dado sta dentro la torre: nella canna, o sulla rampa sotto l'arco. */
  nellaTorre(dado: DadoFisico): boolean {
    return dado.corpo.translation().z < this.torre.z2;
  }

  /** Com'è girato il dado coi suoi numeri: la rotazione del corpo, col giro di questo lancio. */
  orientamento(dado: DadoFisico): Quat {
    return prodotto(dado.corpo.rotation(), dado.giro);
  }

  /** Posizione e orientamento di un dado, per il disegno. */
  posa(dado: DadoFisico): { p: V3; q: Quat } {
    const t = dado.corpo.translation();
    return { p: [t.x, t.y, t.z], q: this.orientamento(dado) };
  }

  /** Dentro il volume del vassoio, col margine. */
  dentro(dado: DadoFisico): boolean {
    const { larghezza: W, profondita: D, coperchio: H } = this.cfg.vassoio;
    const m = this.cfg.margineUscita;
    const t = dado.corpo.translation();
    return Math.abs(t.x) <= W / 2 + m && Math.abs(t.z) <= D / 2 + m && t.y >= -m && t.y <= H + m;
  }

  libera(): void {
    this.pulisci();
    this.world.free();
  }
}

export class Lancio {
  stato: StatoLancio = 'in corso';
  /** Il perché di un tiro fallito, in italiano. */
  motivo: string | null = null;
  letture: LetturaFinale[] | null = null;
  /** Secondi simulati dall'inizio del tiro. */
  tempo = 0;
  /** Ritiri fatti in tutto, coi motivi. */
  readonly registroRitiri: { indice: number; motivo: MotivoRitiro }[] = [];

  private readonly v: Vassoio;
  private readonly fonte: Fonte;
  private readonly opzioni: OpzioniLancio;

  constructor(v: Vassoio, fonte: Fonte, opzioni: OpzioniLancio) {
    this.v = v;
    this.fonte = fonte;
    this.opzioni = opzioni;
  }

  /** Un passo fisso di simulazione, coi controlli di quiete, uscita, tempo e inclinazione. */
  passo(): void {
    if (this.stato !== 'in corso') return;
    const cfg = this.v.cfg;
    const dt = cfg.passo;
    for (const d of this.v.dadi) {
      if (!d.partenza) continue;
      d.attesa -= dt;
      if (d.attesa <= 1e-9) {
        this.v.avvia(d);
        this.opzioni.alRilascio?.(d.indice);
      }
    }
    this.v.world.step();
    this.tempo += dt;

    const daRitirare: { d: DadoFisico; motivo: MotivoRitiro }[] = [];
    let tuttiFermi = true;
    for (const d of this.v.dadi) {
      // Chi aspetta la sua ondata non è ancora in gioco.
      if (d.partenza) {
        tuttiFermi = false;
        continue;
      }
      if (!this.v.dentro(d)) {
        daRitirare.push({ d, motivo: 'uscito' });
        tuttiFermi = false;
        continue;
      }
      const lv = d.corpo.linvel();
      const av = d.corpo.angvel();
      const quieto =
        Math.hypot(lv.x, lv.y, lv.z) < cfg.fermo.velocitaLineare && Math.hypot(av.x, av.y, av.z) < cfg.fermo.velocitaAngolare;
      if (quieto) {
        d.tempoFermo += dt;
      } else {
        // Un dado già fermo e poi urtato riparte da zero col suo tempo massimo.
        if (d.tempoFermo >= cfg.fermo.durata) d.inMovimentoDa = 0;
        d.tempoFermo = 0;
        d.inMovimentoDa += dt;
        if (d.inMovimentoDa > cfg.tempoMassimoDado) daRitirare.push({ d, motivo: 'non si ferma' });
      }
      if (d.tempoFermo < cfg.fermo.durata) tuttiFermi = false;
    }

    if (daRitirare.length === 0 && tuttiFermi) {
      const letture = this.v.dadi.map((d) => {
        const g = geometria(d.spec.forma);
        const l = leggi(g, this.v.orientamento(d));
        return { d, l };
      });
      for (const { d, l } of letture) {
        // Si legge soltanto sul fondo della corte: un dado fermo nella torre si è incastrato.
        if (this.v.nellaTorre(d)) {
          daRitirare.push({ d, motivo: 'nella torre' });
          continue;
        }
        const storto = this.opzioni.controlloStorto
          ? this.opzioni.controlloStorto(d.indice, l.inclinazione)
          : l.inclinazione > cfg.tolleranzaStorto;
        if (storto) daRitirare.push({ d, motivo: 'storto' });
      }
      if (daRitirare.length === 0) {
        this.letture = letture.map(({ d, l }) => ({
          indice: d.indice,
          spec: d.spec,
          faccia: l.faccia,
          lettura: l.lettura,
          valore: valoreDaLettura(d.spec.forma, d.spec.ruolo, l.lettura),
          inclinazione: l.inclinazione,
          ritiri: d.ritiri,
        }));
        this.stato = 'fermo';
        return;
      }
    }

    if (daRitirare.length > 0) this.ritira(daRitirare);
    if (this.stato === 'in corso' && this.tempo > cfg.tempoMassimoTiro) {
      const n = cfg.tempoMassimoTiro;
      this.fallisci(tr({ it: `il tiro non si è chiuso in ${n} secondi`, en: `the roll did not finish within ${n} seconds` }));
    }
  }

  /** Corre fino alla fine (Node, prove): ritorna lo stato finale. */
  finoAllaFine(): StatoLancio {
    while (this.stato === 'in corso') this.passo();
    return this.stato;
  }

  private ritira(lista: { d: DadoFisico; motivo: MotivoRitiro }[]): void {
    const cfg = this.v.cfg;
    for (const { d, motivo } of lista) {
      if (d.ritiri >= cfg.ritiriMassimi) {
        const chi = `${nomeDado(d.spec)} ${nomeMotivo(motivo)}`;
        const volta = VOLTE[cfg.ritiriMassimi] ?? VOLTE.at(-1)!;
        this.fallisci(tr({ it: `${chi} per la ${volta.it} volta: tiro annullato, rilancia`, en: `${chi} for the ${volta.en} time: roll cancelled, roll again` }));
        return;
      }
    }
    // I ritirati tornano nella bocca della torre, a ondate come al lancio.
    const partenze = this.v.partenze(this.fonte, lista.length);
    lista.forEach(({ d, motivo }, k) => {
      d.ritiri += 1;
      this.registroRitiri.push({ indice: d.indice, motivo });
      this.opzioni.alRitiro?.(d.indice, motivo, d.ritiri);
      this.v.metti(d, partenze[k]!);
    });
  }

  private fallisci(motivo: string): void {
    this.stato = 'fallito';
    this.motivo = motivo;
  }
}
