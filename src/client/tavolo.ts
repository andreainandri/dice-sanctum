// Il tavolo nel browser: dalla formula al lancio, la fisica a passo fisso dentro i fotogrammi,
// il disegno interpolato fra due passi, poi la lettura, il conto e l'evento del tiro.

import { fonteCrypto } from '../physics/casuale.ts';
import { FISICA } from '../physics/config.ts';
import { Accumulatore } from '../physics/orologio.ts';
import { lettiDaLetture, specsDaFormula } from '../physics/tiro.ts';
import { type Lancio, type MotivoRitiro, type SpecDado, type Vassoio, nomeDado, nomeMotivo } from '../physics/vassoio.ts';
import { type Conto, calcola } from '../shared/conto.ts';
import { type TiroDalTavolo, tiroDalTavolo } from '../shared/eventi.ts';
import { tr } from '../shared/lingua.ts';
import { type Formula } from '../shared/notazione.ts';
import { type Quat, type V3 } from '../shared/vettori.ts';
import { type Tono } from './facce.ts';
import { type Scena } from './scena.ts';

export interface Ascoltatore {
  inizio(f: Formula, etichetta: string, requestId: string | null): void;
  ritiro(frase: string): void;
  fine(e: TiroDalTavolo): void;
  fallito(motivo: string): void;
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
  ultimo: number | null;
  ok: (e: TiroDalTavolo) => void;
  ko: (e: Error) => void;
}

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

  constructor(vassoio: Vassoio, scena: Scena, ascolta: Ascoltatore) {
    this.vassoio = vassoio;
    this.scena = scena;
    this.ascolta = ascolta;
  }

  get occupato(): boolean {
    return this.corrente !== null;
  }

  /** Toglie i dadi dal vassoio; durante un tiro non fa niente. */
  pulisci(): void {
    if (this.corrente) return;
    this.vassoio.pulisci();
    this.scena.impostaDadi([]);
    this.scena.richiediDisegno();
  }

  /** Lancia i dadi della formula; la promessa si chiude quando sono fermi e letti. */
  tira(formula: Formula, etichetta: string, requestId: string | null = null): Promise<TiroDalTavolo> {
    if (this.corrente) {
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
      });
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    this.scena.impostaDadi(specs);
    const pose = this.leggiPose();
    this.orologio.azzera();
    this.ascolta.inizio(formula, etichetta, requestId);
    return new Promise<TiroDalTavolo>((ok, ko) => {
      this.corrente = { formula, etichetta, requestId, specs, lancio, prima: pose, dopo: pose, ritirati, ultimo: null, ok, ko };
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
      // Un dado ritirato salta in alto: niente interpolazione attraverso il salto.
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
  }

  private fallisci(c: TiroInCorso, motivo: string): void {
    this.corrente = null;
    this.ascolta.fallito(motivo);
    c.ko(new Error(motivo));
  }

  /** Scartati attenuati, il d20 naturale in oro o in rosso; i due dadi di un d100 vanno insieme. */
  private colora(conto: Conto): void {
    let indice = 0;
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
  }
}
