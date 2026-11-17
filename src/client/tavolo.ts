// Il tavolo nel browser: dalla formula al lancio, la fisica a passo fisso dentro i fotogrammi,
// il disegno interpolato fra due passi, poi la lettura, il conto e l'evento del tiro. I lanci del master
// arrivano dal ponte già tirati: qui se ne mostra la ripresa, coi suoi dadi, uno dopo l'altro. Lo stesso
// per i lanci che il master fa al posto di chi gioca, che si vedono coi dadi di chi gioca.

import { fonteCrypto } from '../physics/casuale.ts';
import { FISICA } from '../physics/config.ts';
import { Accumulatore } from '../physics/orologio.ts';
import { type Ripresa, RipresaLetta } from '../physics/ripresa.ts';
import { lettiDaLetture, specsDaFormula } from '../physics/tiro.ts';
import { type Urto, Urti } from '../physics/urti.ts';
import { type Lancio, type MotivoRitiro, type SpecDado, type Vassoio, nomeDado, nomeMotivo } from '../physics/vassoio.ts';
import { type Conto, calcola } from '../shared/conto.ts';
import { type TiroCompletato, type TiroDalTavolo, type TiroDelMaster, tiroDalTavolo } from '../shared/eventi.ts';
import { tr } from '../shared/lingua.ts';
import { type Formula } from '../shared/notazione.ts';
import { PAUSA_DOPO_IL_MASTER } from '../shared/protocollo.ts';
import { type Quat, type V3 } from '../shared/vettori.ts';
import { type Tono } from './facce.ts';
import { type Scena } from './scena.ts';

export interface Ascoltatore {
  inizio(f: Formula, etichetta: string, requestId: string | null): void;
  ritiro(frase: string): void;
  fine(e: TiroDalTavolo): void;
  fallito(motivo: string): void;
  /** I dadi del master partono: i tiri sono già nel registro, ma il risultato si dice a dadi fermi. */
  inizioDelMaster(tiri: readonly TiroDelMaster[]): void;
  /** I dadi del master sono fermi. `visto` è falso quando la ripresa non si poteva mostrare. */
  fineDelMaster(tiri: readonly TiroDelMaster[], visto: boolean): void;
  /** Il master tira al posto di chi gioca: partono i dadi di chi gioca, il risultato si dice a dadi fermi. */
  inizioPerChiGioca(tiri: readonly TiroCompletato[]): void;
  /** I dadi tirati al posto di chi gioca sono fermi. `visto` è falso quando non si sono mostrati. */
  finePerChiGioca(tiri: readonly TiroCompletato[], visto: boolean): void;
  /** Un dado ha toccato qualcosa: serve al suono, che vuole sapere anche di chi sono i dadi. */
  urto?(u: Urto, di: 'master' | 'giocatore'): void;
}

interface Posa {
  p: V3;
  q: Quat;
}

interface TiroInCorso {
  formula: Formula;
  etichetta: string;
  requestId: string | null;
  specs: SpecDado[];
  lancio: Lancio;
  prima: Posa[];
  dopo: Posa[];
  ritirati: Set<number>;
  /** Gli urti del lancio, ricavati passo per passo dalle pose. */
  urti: Urti;
  ultimo: number | null;
  ok: (e: TiroDalTavolo) => void;
  ko: (e: Error) => void;
}

/**
 * Un lancio tirato dal ponte, da mostrare: del master, coi suoi dadi, o fatto dal master al posto di
 * chi gioca, coi dadi di chi gioca. `arrivo` è l'istante in cui la pagina l'ha ricevuto.
 */
type LancioDalPonte = ({ di: 'master'; tiri: readonly TiroDelMaster[] } | { di: 'giocatore'; tiri: readonly TiroCompletato[] }) & {
  ripresa: Ripresa;
  arrivo: number;
};

/**
 * Un lancio che aspetta da più di così, in millisecondi, non si mostra più rotolare: i dadi compaiono
 * fermi. Succede quando la finestra era nascosta (i fotogrammi non arrivano) e chi torna al tavolo
 * troverebbe in fila le riprese di tutta la sua assenza. Due o tre lanci in fila a finestra aperta
 * partono ben prima.
 */
const LANCIO_VECCHIO_MS = 15000;

/**
 * Quanto restano sul vassoio i dadi di chi gioca, in millisecondi, prima che un lancio del master in
 * attesa li sostituisca: il tempo di leggere il proprio tiro.
 */
const PAUSA_DOPO_CHI_GIOCA = 1800;

interface RipresaInCorso {
  lancio: LancioDalPonte;
  letta: RipresaLetta;
  inizio: number | null;
  /** Gli urti della ripresa in ordine di tempo, e quanti ne sono già suonati. */
  urti: { t: number; urto: Urto }[];
  suonati: number;
}

/** Un urto di una ripresa più vecchio di così, in secondi, non si suona più: suonerebbe fuori tempo. */
const URTO_VECCHIO = 0.15;

/** Interpolazione normalizzata: fra due passi da 1/120 s l'angolo è piccolo e basta. */
function nlerp(a: Quat, b: Quat, t: number): Quat {
  const s = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = a.x + (s * b.x - a.x) * t;
  const y = a.y + (s * b.y - a.y) * t;
  const z = a.z + (s * b.z - a.z) * t;
  const w = a.w + (s * b.w - a.w) * t;
  const n = Math.hypot(x, y, z, w);
  return { x: x / n, y: y / n, z: z / n, w: w / n };
}

export class Tavolo {
  private readonly vassoio: Vassoio;
  private readonly scena: Scena;
  private readonly ascolta: Ascoltatore;
  private readonly fonte = fonteCrypto();
  /**
   * Al più quattro passi per fotogramma, il tempo di 30 fotogrammi al secondo: se la fisica non tiene
   * il passo, il tiro si muove al rallentatore e i fotogrammi restano corti. Senza tetto ogni fotogramma
   * lungo chiedeva più passi, che lo allungavano ancora.
   */
  private readonly orologio = new Accumulatore(FISICA.passo, 4);
  private corrente: TiroInCorso | null = null;
  /** I lanci tirati dal ponte che aspettano il vassoio libero, il più vecchio per primo. */
  private readonly inFila: LancioDalPonte[] = [];
  private ripresa: RipresaInCorso | null = null;
  /** La pausa dopo un tiro o una ripresa: il vassoio è libero per chi gioca, il prossimo lancio del master aspetta. */
  private pausa: number | null = null;

  constructor(vassoio: Vassoio, scena: Scena, ascolta: Ascoltatore) {
    this.vassoio = vassoio;
    this.scena = scena;
    this.ascolta = ascolta;
  }

  /** Vero mentre rotolano dei dadi, tirati qui o dal ponte. */
  get occupato(): boolean {
    return this.corrente !== null || this.ripresa !== null;
  }

  /** Toglie i dadi dal vassoio; durante un tiro non fa niente. */
  pulisci(): void {
    if (this.occupato) return;
    this.vassoio.pulisci();
    this.scena.impostaDadi([]);
    this.scena.richiediDisegno();
  }

  /** Lancia i dadi della formula; la promessa si chiude quando sono fermi e letti. */
  tira(formula: Formula, etichetta: string, requestId: string | null = null): Promise<TiroDalTavolo> {
    if (this.occupato) {
      return Promise.reject(
        new Error(tr({ it: 'c’è già un tiro in corso: aspetta che i dadi si fermino', en: 'a roll is already under way: wait for the dice to stop' })),
      );
    }
    const specs = specsDaFormula(formula);
    const ritirati = new Set<number>();
    let lancio: Lancio;
    try {
      lancio = this.vassoio.lancia(specs, this.fonte, {
        alRitiro: (i: number, motivo: MotivoRitiro) => {
          ritirati.add(i);
          const chi = `${nomeDado(specs[i]!)} ${nomeMotivo(motivo)}`;
          this.ascolta.ritiro(tr({ it: `${chi}: lo ritiro`, en: `${chi}: rolling it again` }));
        },
        // Un dado che cade nella torre salta dal posto dove aspettava: come un ritirato, non si interpola.
        alRilascio: (i: number) => ritirati.add(i),
      });
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    this.scena.impostaDadi(specs);
    const pose = this.leggiPose();
    this.orologio.azzera();
    this.ascolta.inizio(formula, etichetta, requestId);
    return new Promise<TiroDalTavolo>((ok, ko) => {
      const urti = new Urti(this.vassoio.cfg, specs.map((s) => s.forma));
      urti.passo(pose.map((p) => p.p), this.vassoio.cfg.passo);
      this.corrente = { formula, etichetta, requestId, specs, lancio, prima: pose, dopo: pose, ritirati, urti, ultimo: null, ok, ko };
      this.mostra(pose, pose, 0);
      requestAnimationFrame(this.giro);
    });
  }

  private leggiPose(): Posa[] {
    return this.vassoio.dadi.map((d) => this.vassoio.posa(d));
  }

  private mostra(prima: readonly Posa[], dopo: readonly Posa[], alfa: number): void {
    dopo.forEach((b, i) => {
      const a = prima[i]!;
      const p: V3 = [a.p[0] + (b.p[0] - a.p[0]) * alfa, a.p[1] + (b.p[1] - a.p[1]) * alfa, a.p[2] + (b.p[2] - a.p[2]) * alfa];
      this.scena.posa(i, p, nlerp(a.q, b.q, alfa));
    });
    this.scena.disegna();
  }

  private readonly giro = (ora: number): void => {
    const c = this.corrente;
    if (!c) return;
    const dt = c.ultimo === null ? 0 : (ora - c.ultimo) / 1000;
    c.ultimo = ora;
    const passi = this.orologio.passi(dt);
    for (let k = 0; k < passi && c.lancio.stato === 'in corso'; k++) {
      c.prima = c.dopo;
      c.ritirati.clear();
      c.lancio.passo();
      c.dopo = this.leggiPose();
      for (const i of c.ritirati) c.urti.salta(i);
      for (const u of c.urti.passo(c.dopo.map((p) => p.p), this.vassoio.cfg.passo)) this.ascolta.urto?.(u, 'giocatore');
      // Un dado ritirato, o appena lasciato cadere, salta di posto: niente interpolazione attraverso il salto.
      if (c.ritirati.size > 0) c.prima = c.prima.map((p, i) => (c.ritirati.has(i) ? c.dopo[i]! : p));
    }
    const alfa = c.lancio.stato === 'in corso' ? this.orologio.alfa : 1;
    this.mostra(c.prima, c.dopo, alfa);
    if (c.lancio.stato === 'fermo') this.concludi(c);
    else if (c.lancio.stato === 'fallito') this.fallisci(c, c.lancio.motivo ?? tr({ it: 'tiro fallito', en: 'roll failed' }));
    else requestAnimationFrame(this.giro);
  };

  private concludi(c: TiroInCorso): void {
    this.corrente = null;
    let evento: TiroDalTavolo;
    try {
      const conto = calcola(c.formula, lettiDaLetture(c.formula, c.lancio.letture!));
      evento = tiroDalTavolo({
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        label: c.etichetta,
        formula: c.formula,
        requestId: c.requestId,
        conto,
      });
      this.colora(conto);
    } catch (e) {
      const perche = e instanceof Error ? e.message : String(e);
      this.fallisci(c, tr({ it: `lettura non riuscita: ${perche}`, en: `reading failed: ${perche}` }));
      return;
    }
    this.scena.disegna();
    this.ascolta.fine(evento);
    c.ok(evento);
    this.riposa(PAUSA_DOPO_CHI_GIOCA);
  }

  private fallisci(c: TiroInCorso, motivo: string): void {
    this.corrente = null;
    this.ascolta.fallito(motivo);
    c.ko(new Error(motivo));
    this.riposa(PAUSA_DOPO_CHI_GIOCA);
  }

  // ---- i lanci tirati dal ponte ----

  /**
   * Un lancio del master da mostrare. Parte quando il vassoio è libero: un tiro di chi gioca non si
   * interrompe mai, e due lanci tirati dal ponte si vedono uno dopo l'altro.
   */
  riproduci(tiri: readonly TiroDelMaster[], ripresa: Ripresa): void {
    this.inFila.push({ di: 'master', tiri, ripresa, arrivo: performance.now() });
    this.avanti();
  }

  /** Un lancio che il master ha fatto al posto di chi gioca: come sopra, coi dadi di chi gioca. */
  riproduciPerChiGioca(tiri: readonly TiroCompletato[], ripresa: Ripresa): void {
    this.inFila.push({ di: 'giocatore', tiri, ripresa, arrivo: performance.now() });
    this.avanti();
  }

  /** Lascia i dadi fermi dove sono per un po', poi fa partire il prossimo lancio in fila. */
  private riposa(ms: number): void {
    if (this.pausa !== null) window.clearTimeout(this.pausa);
    this.pausa = window.setTimeout(() => {
      this.pausa = null;
      this.avanti();
    }, ms);
  }

  private parte(l: LancioDalPonte): void {
    if (l.di === 'master') this.ascolta.inizioDelMaster(l.tiri);
    else this.ascolta.inizioPerChiGioca(l.tiri);
  }

  private finito(l: LancioDalPonte, visto: boolean): void {
    if (l.di === 'master') this.ascolta.fineDelMaster(l.tiri, visto);
    else this.ascolta.finePerChiGioca(l.tiri, visto);
  }

  /** I dadi fermi sui loro numeri: scartati attenuati, naturali in colore. */
  private coloraIlLancio(l: LancioDalPonte): void {
    let indice = 0;
    for (const tiro of l.tiri) indice = this.colora(tiro, indice);
  }

  /** Fa partire il prossimo lancio in fila, se c'è e se il vassoio è libero. */
  private avanti(): void {
    if (this.occupato || this.pausa !== null) return;
    let prossimo = this.inFila.shift();
    if (!prossimo) return;
    // Rimasti indietro: dei lanci vecchi resta sul vassoio soltanto l'ultimo, fermo; gli altri vanno in cronaca.
    const vecchio = (l: LancioDalPonte) => performance.now() - l.arrivo > LANCIO_VECCHIO_MS;
    while (vecchio(prossimo) && this.inFila.length > 0) {
      this.finito(prossimo, false);
      prossimo = this.inFila.shift()!;
    }
    let letta: RipresaLetta;
    try {
      letta = new RipresaLetta(prossimo.ripresa);
      this.vassoio.pulisci();
      this.scena.impostaDadi(prossimo.ripresa.dadi, prossimo.di);
    } catch {
      // Una ripresa che non si legge o non si monta non ferma la fila: i tiri sono nel registro e vanno in cronaca.
      this.scena.impostaDadi([]);
      this.scena.richiediDisegno();
      this.finito(prossimo, false);
      this.avanti();
      return;
    }
    this.parte(prossimo);
    if (vecchio(prossimo)) {
      this.mostraRipresa(letta, letta.durata);
      this.coloraIlLancio(prossimo);
      this.scena.disegna();
      this.finito(prossimo, true);
      return;
    }
    this.ripresa = { lancio: prossimo, letta, inizio: null, urti: this.urtiDellaRipresa(letta), suonati: 0 };
    this.mostraRipresa(letta, 0);
    requestAnimationFrame(this.giroDelMaster);
  }

  /** Gli urti di una ripresa, ognuno col suo istante: si ricavano dalle pose prima di mostrarla. */
  private urtiDellaRipresa(letta: RipresaLetta): { t: number; urto: Urto }[] {
    const { dadi, passo, fotogrammi } = letta.ripresa;
    const urti = new Urti(this.vassoio.cfg, dadi.map((d) => d.forma));
    const esce: { t: number; urto: Urto }[] = [];
    for (let f = 0; f < fotogrammi; f++) {
      dadi.forEach((_, i) => {
        if (letta.salta(f, i)) urti.salta(i);
      });
      for (const urto of urti.passo(dadi.map((_, i) => letta.posa(f, i).p), passo)) esce.push({ t: f * passo, urto });
    }
    return esce;
  }

  /** Le pose al tempo `t` della ripresa, interpolate fra due fotogrammi. */
  private mostraRipresa(letta: RipresaLetta, t: number): void {
    const ultimo = letta.ripresa.fotogrammi - 1;
    const f = Math.min(ultimo, Math.max(0, t / letta.ripresa.passo));
    const a = Math.floor(f);
    const b = Math.min(ultimo, a + 1);
    const alfa = f - a;
    letta.ripresa.dadi.forEach((_, i) => {
      const prima = letta.posa(a, i);
      // Un dado ritirato salta in alto: resta dov'era fino al fotogramma del salto.
      if (b === a || letta.salta(b, i)) {
        this.scena.posa(i, prima.p, prima.q);
        return;
      }
      const dopo = letta.posa(b, i);
      const p: V3 = [
        prima.p[0] + (dopo.p[0] - prima.p[0]) * alfa,
        prima.p[1] + (dopo.p[1] - prima.p[1]) * alfa,
        prima.p[2] + (dopo.p[2] - prima.p[2]) * alfa,
      ];
      this.scena.posa(i, p, nlerp(prima.q, dopo.q, alfa));
    });
    this.scena.disegna();
  }

  private readonly giroDelMaster = (ora: number): void => {
    const r = this.ripresa;
    if (!r) return;
    // Il primo fotogramma arriva tardi quando la finestra era nascosta: un lancio ormai vecchio va dritto
    // alla fine, in silenzio.
    if (r.inizio === null && performance.now() - r.lancio.arrivo > LANCIO_VECCHIO_MS) {
      r.inizio = ora - r.letta.durata * 1000;
      r.suonati = r.urti.length;
    }
    r.inizio ??= ora;
    const t = (ora - r.inizio) / 1000;
    this.mostraRipresa(r.letta, t);
    // Gli urti passati da poco suonano; quelli rimasti indietro (la scheda era in sottofondo) si saltano.
    while (r.suonati < r.urti.length && r.urti[r.suonati]!.t <= t) {
      const { t: quando, urto } = r.urti[r.suonati++]!;
      if (t - quando < URTO_VECCHIO) this.ascolta.urto?.(urto, r.lancio.di);
    }
    if (t < r.letta.durata) {
      requestAnimationFrame(this.giroDelMaster);
      return;
    }
    this.ripresa = null;
    this.coloraIlLancio(r.lancio);
    this.scena.disegna();
    this.finito(r.lancio, true);
    // Un lancio rimasto indietro con altri in fila non si ferma a farsi leggere: resta l'ultimo.
    if (performance.now() - r.lancio.arrivo > LANCIO_VECCHIO_MS && this.inFila.length > 0) this.avanti();
    else this.riposa(PAUSA_DOPO_IL_MASTER);
  };

  /**
   * Scartati attenuati, il d20 naturale in oro o in rosso; i due dadi di un d100 vanno insieme. I dadi
   * del conto cominciano da `da`; ritorna l'indice dopo l'ultimo.
   */
  private colora(conto: Pick<Conto, 'groups' | 'nat20' | 'nat1'>, da = 0): number {
    let indice = da;
    for (const g of conto.groups) {
      for (const d of g.dice) {
        let tono: Tono = d.kept ? 'normale' : 'scartato';
        if (d.kept && g.sides === 20 && g.sign === 1) {
          if (conto.nat20 && d.value === 20) tono = 'oro';
          if (conto.nat1 && d.value === 1) tono = 'rosso';
        }
        const fisici = g.sides === 100 ? 2 : 1;
        for (let k = 0; k < fisici; k++) this.scena.tono(indice + k, tono);
        // Il lampo corre nei fotogrammi dopo: l'evento del tiro parte subito, come senza.
        if (tono === 'oro') this.scena.lampo(indice);
        indice += fisici;
      }
    }
    return indice;
  }
}
