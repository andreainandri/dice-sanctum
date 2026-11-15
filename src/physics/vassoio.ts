// Il vassoio: un mondo Rapier con fondo, sponde e coperchio invisibile, e i dadi di un tiro.
// Lo stesso codice gira nel browser (un passo alla volta, dentro i fotogrammi) e in Node
// (le prove di equità, a ciclo continuo).

import RAPIER from '@dimforge/rapier3d-compat';
import { type Forma, type Ruolo, geometria, valoreDaLettura } from '../shared/dadi.ts';
import { leggi } from '../shared/lettura.ts';
import { tr } from '../shared/lingua.ts';
import { type Quat, type V3, normalizza, punto, quatDaAsseAngolo, ruota } from '../shared/vettori.ts';
import { type Fonte, direzioneUniforme, intervallo, mescola, quatUniforme } from './casuale.ts';
import { FISICA, type ConfigFisica } from './config.ts';

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

export type MotivoRitiro = 'storto' | 'uscito' | 'non si ferma';

export interface DadoFisico {
  readonly indice: number;
  readonly spec: SpecDado;
  readonly corpo: RAPIER.RigidBody;
  ritiri: number;
  /** Da quanto il dado sta sotto le soglie di quiete, in secondi. */
  tempoFermo: number;
  /** Da quanto il dado si muove senza essersi mai fermato, in secondi. */
  inMovimentoDa: number;
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
}

/** Che cosa ha fatto un dado da ritirare, nelle frasi dopo il suo nome. */
export function nomeMotivo(m: MotivoRitiro): string {
  if (m === 'storto') return tr({ it: 'si è fermato storto', en: 'came to rest tilted' });
  if (m === 'uscito') return tr({ it: 'è uscito dal vassoio', en: 'left the tray' });
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
    return fondo;
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
    const posti = this.postiDiLancio(fonte, specs.length);
    const lato = posti.lato;
    this.dadiAttuali = specs.map((spec, indice) => {
      const desc = R.RigidBodyDesc.dynamic()
        .setLinearDamping(this.cfg.dado.smorzamentoLineare)
        .setAngularDamping(this.cfg.dado.smorzamentoAngolare)
        // Senza CCD: un piano non si attraversa, e fra dado e dado bastano i contatti anticipati di
        // Rapier. Col CCD durate, ritiri e falliti erano gli stessi, e il passo costava il 10% in più
        // (un terzo nei passi più pesanti).
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
      const dado: DadoFisico = { indice, spec, corpo, ritiri: 0, tempoFermo: 0, inMovimentoDa: 0 };
      this.getta(dado, posti.punti[indice]!, lato, fonte);
      return dado;
    });
    this.lancioAttuale = new Lancio(this, fonte, opzioni);
    return this.lancioAttuale;
  }

  /**
   * Posti di partenza: una griglia nella fascia vicina alla sponda del lato scelto,
   * a strati, con le celle in ordine casuale. Celle larghe quanto il dado più grande,
   * così i dadi non nascono compenetrati.
   */
  postiDiLancio(fonte: Fonte, quanti: number, lato?: 1 | -1): { lato: 1 | -1; punti: V3[] } {
    const { larghezza: W, profondita: D, coperchio: H } = this.cfg.vassoio;
    const L = this.cfg.lancio;
    const s: 1 | -1 = lato ?? (fonte.uniforme() < 0.5 ? -1 : 1);
    const passo = L.passoGriglia;
    const colonne = Math.max(1, Math.floor(L.fascia / passo));
    const righe = Math.max(1, Math.floor((D - 1) / passo));
    const celle: V3[] = [];
    for (let y = L.altezzaMinima; y + passo / 2 < H; y += passo) {
      for (let c = 0; c < colonne; c++) {
        for (let r = 0; r < righe; r++) {
          const x = s * (W / 2 - 0.5 - passo / 2 - c * passo);
          const z = -((righe - 1) * passo) / 2 + r * passo;
          celle.push([x, y, z]);
        }
      }
    }
    if (celle.length < quanti) throw new Error(`posti di lancio insufficienti: ${celle.length} per ${quanti} dadi`);
    mescola(fonte, celle);
    const punti = celle.slice(0, quanti).map(
      (p): V3 => [
        p[0] + intervallo(fonte, -L.scarto, L.scarto),
        p[1] + intervallo(fonte, -L.scarto, L.scarto),
        p[2] + intervallo(fonte, -L.scarto, L.scarto),
      ],
    );
    return { lato: s, punti };
  }

  /**
   * Il lancio dalla mano: dal posto sulla sponda verso un punto della parte lontana del vassoio,
   * con una deviazione, sempre verso l'interno.
   */
  getta(dado: DadoFisico, posizione: V3, lato: 1 | -1, fonte: Fonte): void {
    const L = this.cfg.lancio;
    const { larghezza: W, profondita: D } = this.cfg.vassoio;
    const bersaglio: V3 = [
      -lato * intervallo(fonte, -W / 6, W / 2 - 4),
      0,
      intervallo(fonte, -(D / 2 - 3), D / 2 - 3),
    ];
    let dir = normalizza([bersaglio[0] - posizione[0], 0, bersaglio[2] - posizione[2]]);
    const deviazione = (intervallo(fonte, -L.deviazione, L.deviazione) * Math.PI) / 180;
    dir = ruota(quatDaAsseAngolo([0, 1, 0], deviazione), dir);
    if (punto(dir, [-lato, 0, 0]) < 0.2) dir = normalizza([-lato, 0, dir[2]]);
    const v = intervallo(fonte, L.velocitaMinima, L.velocitaMassima);
    this.metti(dado, posizione, [dir[0] * v, -intervallo(fonte, 0, L.caduta), dir[2] * v], fonte);
  }

  /**
   * Il ritiro: il dado si raccoglie e si rilascia dall'alto sopra il punto più libero del vassoio,
   * con poca spinta di lato e la rotazione piena, come lo si rilancia a mano dov'è spazio.
   */
  rilascia(dado: DadoFisico, altri: readonly DadoFisico[], altezza: number, fonte: Fonte): void {
    const L = this.cfg.lancio;
    const { larghezza: W, profondita: D } = this.cfg.vassoio;
    const occupati = altri.map((d) => d.corpo.translation());
    let migliore: V3 = [0, altezza, 0];
    let distanza = -1;
    for (let k = 0; k < 16; k++) {
      const p: V3 = [intervallo(fonte, -(W / 2 - 3), W / 2 - 3), altezza, intervallo(fonte, -(D / 2 - 3), D / 2 - 3)];
      const vicino = occupati.reduce((m, t) => Math.min(m, Math.hypot(t.x - p[0], t.z - p[2])), Infinity);
      if (vicino > distanza) {
        distanza = vicino;
        migliore = p;
      }
    }
    const a = 2 * Math.PI * fonte.uniforme();
    const v = intervallo(fonte, L.spintaRitiroMinima, L.spintaRitiroMassima);
    this.metti(dado, migliore, [Math.cos(a) * v, -intervallo(fonte, 0, L.caduta), Math.sin(a) * v], fonte);
  }

  /** Posizione, orientamento uniforme, velocità data e rotazione su un asse uniforme. */
  private metti(dado: DadoFisico, posizione: V3, velocita: V3, fonte: Fonte): void {
    const L = this.cfg.lancio;
    const q = quatUniforme(fonte);
    const asse = direzioneUniforme(fonte);
    const w = intervallo(fonte, L.rotazioneMinima, L.rotazioneMassima);
    const c = dado.corpo;
    c.setTranslation({ x: posizione[0], y: posizione[1], z: posizione[2] }, true);
    c.setRotation(q, true);
    c.setLinvel({ x: velocita[0], y: velocita[1], z: velocita[2] }, true);
    c.setAngvel({ x: asse[0] * w, y: asse[1] * w, z: asse[2] * w }, true);
    c.resetForces(true);
    c.resetTorques(true);
    dado.tempoFermo = 0;
    dado.inMovimentoDa = 0;
  }

  /** Posizione e rotazione di un dado, per il disegno. */
  posa(dado: DadoFisico): { p: V3; q: Quat } {
    const t = dado.corpo.translation();
    const r = dado.corpo.rotation();
    return { p: [t.x, t.y, t.z], q: { x: r.x, y: r.y, z: r.z, w: r.w } };
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
    this.v.world.step();
    this.tempo += dt;

    const daRitirare: { d: DadoFisico; motivo: MotivoRitiro }[] = [];
    let tuttiFermi = true;
    for (const d of this.v.dadi) {
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
        const l = leggi(g, d.corpo.rotation());
        return { d, l };
      });
      for (const { d, l } of letture) {
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
        this.fallisci(tr({ it: `${chi} per la terza volta: tiro annullato, rilancia`, en: `${chi} for the third time: roll cancelled, roll again` }));
        return;
      }
    }
    // Uno alla volta, così ognuno sceglie il suo punto libero vedendo anche quelli già rimessi in aria.
    lista.forEach(({ d, motivo }, k) => {
      d.ritiri += 1;
      this.registroRitiri.push({ indice: d.indice, motivo });
      this.opzioni.alRitiro?.(d.indice, motivo, d.ritiri);
      const altezza = cfg.lancio.altezzaRitiro + (k % 3) * cfg.lancio.passoGriglia;
      this.v.rilascia(
        d,
        this.v.dadi.filter((x) => x !== d),
        altezza,
        this.fonte,
      );
    });
  }

  private fallisci(motivo: string): void {
    this.stato = 'fallito';
    this.motivo = motivo;
  }
}
