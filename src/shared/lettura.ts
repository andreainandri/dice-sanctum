// Lettura di un dado fermo: la normale locale di ogni faccia, ruotata col quaternione del
// dado; vince quella più vicina alla verticale (verso l'alto, o verso il basso per il d4).

import { type Geometria } from './dadi.ts';
import { type Quat, type V3, quatDaA, ruota } from './vettori.ts';

export interface Lettura {
  /** Indice della faccia di lettura. */
  faccia: number;
  /** Il numero della tabella per quella faccia (d10: 0..9). */
  lettura: number;
  /** Angolo fra la normale della faccia di lettura e la verticale, in gradi. */
  inclinazione: number;
}

const SU: V3 = [0, 1, 0];
const GIU: V3 = [0, -1, 0];

export function leggi(g: Geometria, q: Quat): Lettura {
  const verso = g.letturaInBasso ? -1 : 1;
  let migliore = -1;
  let massimo = -Infinity;
  for (let i = 0; i < g.normali.length; i++) {
    const n = ruota(q, g.normali[i]!);
    const allineamento = n[1] * verso;
    if (allineamento > massimo) {
      massimo = allineamento;
      migliore = i;
    }
  }
  const coseno = Math.min(1, Math.max(-1, massimo));
  return {
    faccia: migliore,
    lettura: g.letture[migliore]!,
    inclinazione: (Math.acos(coseno) * 180) / Math.PI,
  };
}

/** Un orientamento che mette la faccia i in posizione di lettura (prove e dimostrazioni). */
export function orientamentoPerFaccia(g: Geometria, i: number): Quat {
  return quatDaA(g.normali[i]!, g.letturaInBasso ? GIU : SU);
}
