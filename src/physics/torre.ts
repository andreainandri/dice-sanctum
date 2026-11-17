// Le misure della torre dei dadi, ricavate dalla configurazione: le usano la fisica, per i collisori, e la
// scena, per disegnarla. La torre occupa il lato di fondo del vassoio, per tutta la sua larghezza: la
// sponda di fondo e le due di fianco le fanno da pareti, e la quarta parete, con l'arco d'uscita lungo
// quanto la torre, la separa dalla corte. I dadi cadono nella bocca, scendono da uno scivolo all'altro, e
// la rampa li porta fuori dall'arco, verso chi guarda, già sparsi per la larghezza.
// Scivoli e rampa sono profili nel piano z-y, lunghi quanto il vassoio è largo.

import { type ConfigFisica } from './config.ts';

/** Un punto del profilo, nel piano z-y. */
export type PuntoProfilo = readonly [z: number, y: number];

export interface MisureTorre {
  /** La torre è larga quanto il vassoio: da x0 a x1. */
  x0: number;
  x1: number;
  /** La canna va da z0 (la sponda di fondo) a z1; z2 è la faccia della parete verso la corte. */
  z0: number;
  z1: number;
  z2: number;
  /** L'orlo della bocca. */
  alta: number;
  /** L'altezza dell'arco d'uscita. */
  arco: number;
  /** Gli scivoli, dal più alto al più basso: profili chiusi. */
  scivoli: PuntoProfilo[][];
  /** La rampa d'uscita, dalla sponda di fondo al piano della corte sotto la faccia di fuori dell'arco. */
  rampa: PuntoProfilo[];
}

export function misureTorre(cfg: ConfigFisica): MisureTorre {
  const T = cfg.torre;
  const z0 = -cfg.vassoio.profondita / 2;
  const z1 = z0 + T.profonda;
  const z2 = z1 + T.parete;
  const quotaRampa = (z: number) => T.rampa * (1 - (z - z0) / (z2 - z0));
  const scivoli: PuntoProfilo[][] = [];
  // Dal basso: sotto ogni scivolo resta la luce, misurata al suo labbro dalla superficie su cui i dadi
  // scivolano lì sotto (la rampa per il primo, il labbro dello scivolo di sotto per gli altri).
  let sottoIlLabbro = (z: number) => quotaRampa(z);
  for (const s of T.scivoli) {
    const muro = s.da === 'fondo' ? z0 : z1;
    const labbro = muro + (s.da === 'fondo' ? s.sporge : -s.sporge);
    const sotto = sottoIlLabbro(labbro) + T.luce;
    const cimaAlLabbro = sotto + T.labbro;
    scivoli.unshift([
      [muro, cimaAlLabbro + s.scende],
      [labbro, cimaAlLabbro],
      [labbro, sotto],
      [muro, sotto],
    ]);
    sottoIlLabbro = () => cimaAlLabbro;
  }
  const cima = scivoli.length > 0 ? scivoli[0]![0]![1] : T.rampa;
  return {
    x0: -cfg.vassoio.larghezza / 2,
    x1: cfg.vassoio.larghezza / 2,
    z0,
    z1,
    z2,
    alta: cima + T.orlo,
    arco: T.arco,
    scivoli,
    rampa: [
      [z0, T.rampa],
      [z2, 0],
      [z2, -1],
      [z0, -1],
    ],
  };
}

/** La corte, dove i dadi rotolano e si leggono: dalla parete della torre alla sponda davanti. */
export function misureCorte(cfg: ConfigFisica): { x0: number; x1: number; z0: number; z1: number } {
  const t = misureTorre(cfg);
  return { x0: t.x0, x1: t.x1, z0: t.z2, z1: cfg.vassoio.profondita / 2 };
}

/**
 * I centri delle celle della bocca, come [x, z]: una griglia dentro la canna, con celle larghe `passo` e
 * a distanza almeno `gioco` dalle pareti.
 */
export function celleDellaBocca(t: MisureTorre, passo: number, gioco: number): [number, number][] {
  const colonne = Math.max(1, Math.floor((t.x1 - t.x0 - 2 * gioco) / passo) + 1);
  const righe = Math.max(1, Math.floor((t.z1 - t.z0 - 2 * gioco) / passo) + 1);
  const celle: [number, number][] = [];
  for (let c = 0; c < colonne; c++) {
    for (let r = 0; r < righe; r++) {
      celle.push([(t.x0 + t.x1) / 2 + (c - (colonne - 1) / 2) * passo, (t.z0 + t.z1) / 2 + (r - (righe - 1) / 2) * passo]);
    }
  }
  return celle;
}
