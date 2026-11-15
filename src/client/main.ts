// L'avvio della pagina: fisica, scena, interfaccia, tavolo e collegamento col ponte, più
// `window.__sanctum` per le prove.

import { Vassoio, caricaRapier } from '../physics/vassoio.ts';
import { fonteCrypto } from '../physics/casuale.ts';
import { FISICA } from '../physics/config.ts';
import { specsDaFormula } from '../physics/tiro.ts';
import { type RichiestaCreata, type TiroDalTavolo } from '../shared/eventi.ts';
import { tr } from '../shared/lingua.ts';
import { leggiFormula } from '../shared/notazione.ts';
import { caricaCaratteri } from './caratteri.ts';
import { Collegamento } from './collegamento.ts';
import { Interfaccia, preparaLingua } from './interfaccia.ts';
import { caricaTrame } from './materiali.ts';
import { Scena } from './scena.ts';
import { type Ascoltatore, Tavolo } from './tavolo.ts';

declare global {
  interface Window {
    __sanctum?: {
      /** Tira una formula come dal campo; si chiude quando i dadi sono fermi e letti. */
      roll(formula: string, label?: string): Promise<TiroDalTavolo>;
      /** Tira la richiesta del DM in cima all'avviso, come il suo TIRA. */
      tiraRichiesta(): Promise<TiroDalTavolo>;
      /** Le richieste del DM che l'avviso mostra, la più vecchia per prima. */
      richieste(): RichiestaCreata[];
      /** Vero mentre i dadi rotolano. */
      occupato(): boolean;
      /** Vero quando il ponte ha risposto e il tavolo è collegato. */
      collegato(): boolean;
      /** Quanti tiri aspettano di arrivare al registro. */
      inCoda(): number;
      /** Dove si vedono i dadi dell'ultimo tiro, in pixel della pagina. */
      dadiSulloSchermo(): { x: number; y: number; raggio: number; lettura: { x: number; y: number } }[];
    };
  }
}

// Per prima la lingua: la pagina si mostra quando i suoi testi sono quelli giusti.
preparaLingua();
// Prima della scena: il carattere, con cui si dipingono i numeri dei dadi, e le foto di noce, velluto e tavolo.
const [R, , trame] = await Promise.all([caricaRapier(), caricaCaratteri(), caricaTrame()]);
const vassoio = new Vassoio(R, FISICA);
// Un tiro a vuoto con ogni tipo di dado: i primi passi su un mondo nuovo costano decine di
// millisecondi, e li paga l'avvio al posto del primo tiro vero.
{
  const l = vassoio.lancia(specsDaFormula(leggiFormula('5d4+5d6+5d8+5d12+5d20+2d100+1d10')), fonteCrypto());
  for (let k = 0; k < 30 && l.stato === 'in corso'; k++) l.passo();
  vassoio.pulisci();
}
const scena = new Scena(document.getElementById('tela')!, FISICA, trame);

/** Il TIRA dell'avviso: esattamente la formula e l'etichetta della richiesta. */
const tiraPerIlDm = async (r: RichiestaCreata): Promise<TiroDalTavolo> => {
  let f;
  try {
    f = leggiFormula(r.formula);
  } catch (e) {
    const perche = e instanceof Error ? e.message : String(e);
    ui.fallito(
      tr({ it: `la richiesta ${r.requestId} ha una formula che non si legge: ${perche}`, en: `request ${r.requestId} has a formula that cannot be read: ${perche}` }),
    );
    throw e;
  }
  return tavolo.tira(f, r.label, r.requestId);
};

// Interfaccia, tavolo e collegamento si chiamano a vicenda soltanto dopo l'avvio, quando ci sono tutti.
const ui = new Interfaccia({
  lancia: (f, etichetta) => tavolo.tira(f, etichetta),
  lanciaRichiesta: tiraPerIlDm,
  pulisci: () => tavolo.pulisci(),
});
const ascolta: Ascoltatore = {
  inizio: () => ui.inizio(),
  ritiro: (frase) => ui.ritiro(frase),
  fine: (e) => {
    ui.fine(e);
    collegamento.invia(e);
  },
  fallito: (motivo) => ui.fallito(motivo),
};
const tavolo = new Tavolo(vassoio, scena, ascolta);
const collegamento = new Collegamento(ui);
document.getElementById('caricamento')?.remove();

window.__sanctum = {
  roll: (formula, label = '') => tavolo.tira(leggiFormula(formula), label.trim()),
  tiraRichiesta: () => {
    const r = ui.richiesteAperte[0];
    return r ? tiraPerIlDm(r) : Promise.reject(new Error(tr({ it: 'nessuna richiesta del DM sul tavolo', en: 'no DM request on the table' })));
  },
  richieste: () => ui.richiesteAperte.map((r) => ({ ...r })),
  occupato: () => tavolo.occupato,
  collegato: () => collegamento.eCollegato,
  inCoda: () => collegamento.inCoda.length,
  dadiSulloSchermo: () => scena.dadiSulloSchermo(),
};
