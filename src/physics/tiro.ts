// Dalla formula ai dadi sul tavolo e ritorno: quali dadi fisici chiede ogni gruppo,
// e come le letture finali tornano nei gruppi del conto.

import { type DadoLetto } from '../shared/conto.ts';
import { type Forma, valoreD100 } from '../shared/dadi.ts';
import { type Formula, gruppi } from '../shared/notazione.ts';
import { type LetturaFinale, type SpecDado } from './vassoio.ts';

/** I dadi fisici in ordine di formula: il d100 dà due d10, decine e unità. */
export function specsDaFormula(f: Formula): SpecDado[] {
  const out: SpecDado[] = [];
  for (const g of gruppi(f)) {
    for (let i = 0; i < g.numero; i++) {
      if (g.lati === 100) {
        out.push({ forma: 'd10', ruolo: 'decine' }, { forma: 'd10', ruolo: 'unita' });
      } else {
        out.push({ forma: `d${g.lati}` as Forma, ruolo: 'semplice' });
      }
    }
  }
  return out;
}

/** Le letture finali, nello stesso ordine di specsDaFormula, raccolte per gruppo. */
export function lettiDaLetture(f: Formula, letture: readonly LetturaFinale[]): DadoLetto[][] {
  const ordinate = [...letture].sort((a, b) => a.indice - b.indice);
  let k = 0;
  const prendi = () => {
    const l = ordinate[k++];
    if (!l) throw new Error('letture insufficienti per la formula');
    return l;
  };
  const out = gruppi(f).map((g) => {
    const dadi: DadoLetto[] = [];
    for (let i = 0; i < g.numero; i++) {
      if (g.lati === 100) {
        const decine = prendi();
        const unita = prendi();
        dadi.push({
          value: valoreD100(decine.valore, unita.valore),
          tens: decine.valore,
          units: unita.valore,
          rethrows: decine.ritiri + unita.ritiri,
        });
      } else {
        const l = prendi();
        dadi.push({ value: l.valore, rethrows: l.ritiri });
      }
    }
    return dadi;
  });
  if (k !== ordinate.length) throw new Error('letture in più rispetto alla formula');
  return out;
}
