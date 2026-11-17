// La mano del master: il ponte tira i dadi del DM in un vassoio suo, senza browser, con la stessa fisica
// e la stessa fonte del caso del tavolo, e riprende il lancio perché il tavolo lo mostri.

import { fonteCrypto } from '../physics/casuale.ts';
import { FISICA } from '../physics/config.ts';
import { type Ripresa, riprendi } from '../physics/ripresa.ts';
import { lettiDaLetture, specsDaFormula } from '../physics/tiro.ts';
import { Vassoio, caricaRapier } from '../physics/vassoio.ts';
import { type Conto, calcola } from '../shared/conto.ts';
import { type Formula } from '../shared/notazione.ts';

/** Un lancio fallito (un dado ritirato tre volte) si rifà da capo, fino a tante volte. */
const TENTATIVI = 3;

export interface LancioDelMaster {
  /** Un conto per formula, nello stesso ordine. */
  conti: Conto[];
  ripresa: Ripresa;
  /** Quanto dura la ripresa, in secondi. */
  durata: number;
}

export class ManoDelMaster {
  private vassoio: Vassoio | null = null;
  private readonly fonte = fonteCrypto();

  /** Tira insieme i dadi di tutte le formule, in un lancio solo. */
  async tira(formule: readonly Formula[]): Promise<LancioDelMaster> {
    const R = await caricaRapier();
    this.vassoio ??= new Vassoio(R, FISICA);
    const specs = formule.flatMap((f) => specsDaFormula(f));
    let motivo = '';
    for (let k = 0; k < TENTATIVI; k++) {
      const esito = riprendi(this.vassoio, specs, this.fonte);
      if (esito.stato === 'fallito') {
        motivo = esito.motivo;
        continue;
      }
      // Le letture escono nell'ordine dei dadi: ogni formula prende le sue.
      let da = 0;
      const conti = formule.map((f) => {
        const sue = esito.letture.slice(da, da + f.dadiFisici);
        da += f.dadiFisici;
        return calcola(f, lettiDaLetture(f, sue));
      });
      this.vassoio.pulisci();
      return { conti, ripresa: esito.ripresa, durata: esito.durata };
    }
    this.vassoio.pulisci();
    throw new Error(`the DM throw failed ${TENTATIVI} times in a row: ${motivo}`);
  }

  libera(): void {
    this.vassoio?.libera();
    this.vassoio = null;
  }
}
