// Gli urti dei dadi, ricavati dal loro moto: a ogni passo si guarda di quanto è cambiata la velocità di
// ogni dado oltre a quello che fa la gravità, e un cambio brusco è un urto. Servono al suono. Non si chiede
// niente al motore della fisica: bastano le posizioni, quindi valgono allo stesso modo per un lancio che
// si sta simulando e per la ripresa di un lancio del master, che arriva già fatta.

import { type Forma, geometria } from '../shared/dadi.ts';
import { type V3 } from '../shared/vettori.ts';
import { type ConfigFisica } from './config.ts';
import { misureTorre } from './torre.ts';

/** Che cosa ha toccato il dado: il fondo foderato della corte, il legno (sponde, scivoli, rampa), un altro dado. */
export type TipoUrto = 'fondo' | 'sponda' | 'dado';

export interface Urto {
  /** L'indice del dado. */
  dado: number;
  tipo: TipoUrto;
  /** Da 0 a 1. */
  forza: number;
  /** Dove, lungo la larghezza del vassoio: da -1 (sinistra) a 1 (destra). */
  lato: number;
  /** Dentro la torre, dove il dado non si vede. */
  nellaTorre: boolean;
}

/**
 * Le soglie, in centimetri al secondo di velocità cambiata in un passo: sotto `minima` un urto non si
 * sente (un dado che rotola ne fa tanti piccoli), da `piena` in su suona a tutta forza. `riposo` è il
 * tempo minimo, in secondi, fra due urti dello stesso dado, salvo che il secondo sia ben più forte.
 */
const SOGLIE = { minima: 24, piena: 280, riposo: 0.03, piuForte: 1.5 } as const;
/** Due dadi si toccano se i centri distano meno della somma dei raggi per questo fattore. */
const VICINI = 1.08;

interface Memoria {
  p: V3 | null;
  v: V3 | null;
  /** Secondi dall'ultimo urto che ha suonato, e la sua forza. */
  daUltimo: number;
  ultima: number;
}

export class Urti {
  private readonly raggi: number[];
  private readonly memoria: Memoria[];
  private readonly gravita: number;
  private readonly mezzaLarghezza: number;
  private readonly facciata: number;

  constructor(cfg: ConfigFisica, forme: readonly Forma[]) {
    this.raggi = forme.map((f) => geometria(f).raggio);
    this.memoria = forme.map(() => ({ p: null, v: null, daUltimo: Infinity, ultima: 0 }));
    this.gravita = cfg.gravita;
    this.mezzaLarghezza = cfg.vassoio.larghezza / 2;
    this.facciata = misureTorre(cfg).z2;
  }

  /** Il dado è stato spostato (ritirato, o lasciato cadere alla sua ondata): il suo moto ricomincia da capo. */
  salta(dado: number): void {
    const m = this.memoria[dado];
    if (!m) return;
    m.p = null;
    m.v = null;
  }

  /** Le posizioni dei dadi dopo un passo lungo `dt` secondi: rende gli urti avvenuti in quel passo. */
  passo(posizioni: readonly V3[], dt: number): Urto[] {
    const urti: Urto[] = [];
    posizioni.forEach((p, i) => {
      const m = this.memoria[i];
      if (!m) return;
      m.daUltimo += dt;
      const prima = m.p;
      const vPrima = m.v;
      m.p = p;
      if (!prima) return;
      const v: V3 = [(p[0] - prima[0]) / dt, (p[1] - prima[1]) / dt, (p[2] - prima[2]) / dt];
      m.v = v;
      if (!vPrima) return;
      // Quello che la velocità ha fatto in più della caduta libera: la spinta di ciò che il dado ha toccato.
      const spinta: V3 = [v[0] - vPrima[0], v[1] - vPrima[1] + this.gravita * dt, v[2] - vPrima[2]];
      // Un dado fermo sul fondo riceve a ogni passo la spinta che lo regge: non è un urto, e si toglie.
      const quanta = Math.hypot(spinta[0], spinta[1], spinta[2]) - this.gravita * dt;
      if (quanta < SOGLIE.minima) return;
      const forza = Math.min(1, (quanta - SOGLIE.minima) / (SOGLIE.piena - SOGLIE.minima)) ** 0.7;
      if (m.daUltimo < SOGLIE.riposo && forza < m.ultima * SOGLIE.piuForte) return;
      m.daUltimo = 0;
      m.ultima = forza;
      const nellaTorre = p[2] < this.facciata;
      const raggio = this.raggi[i]!;
      const daSotto = spinta[1] > 0.75 * (quanta + this.gravita * dt) && p[1] < raggio * 1.3;
      const toccaUnDado = posizioni.some((q, j) => j !== i && Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < (raggio + this.raggi[j]!) * VICINI);
      let tipo: TipoUrto;
      if (daSotto && !nellaTorre) tipo = 'fondo';
      else if (toccaUnDado && !daSotto) tipo = 'dado';
      else tipo = 'sponda';
      urti.push({ dado: i, tipo, forza, lato: Math.max(-1, Math.min(1, p[0] / this.mezzaLarghezza)), nellaTorre });
    });
    return urti;
  }
}
