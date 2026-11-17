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
import { SERIE_DEL_MASTER_DI_PARTENZA, SERIE_DI_PARTENZA, type Serie, eSerie, serieLibera } from '../shared/serie.ts';
import { MATERIA } from './facce.ts';
import { Scena } from './scena.ts';
import { Suono, montaPulsanteDelSuono } from './suono.ts';
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
// Le serie di dadi di chi gioca e del master restano scritte da una visita all'altra: quella del master la
// manda il ponte, e la copia qui serve soltanto ad aprire la pagina giusta prima che arrivi.
const CHIAVE_SERIE = 'dice-sanctum.serie';
const CHIAVE_SERIE_DEL_MASTER = 'dice-sanctum.serie-del-master';
const leggiSerie = (chiave: string, altrimenti: Serie): Serie => {
  try {
    const s = localStorage.getItem(chiave);
    return eSerie(s) ? s : altrimenti;
  } catch {
    return altrimenti;
  }
};
const scriviSerie = (chiave: string, serie: Serie) => {
  try {
    localStorage.setItem(chiave, serie);
  } catch {
    // Senza localStorage la scelta vale fino alla chiusura della pagina.
  }
};
let serieDelMaster = leggiSerie(CHIAVE_SERIE_DEL_MASTER, SERIE_DEL_MASTER_DI_PARTENZA);
/** La serie di chi gioca adesso: il suono degli urti ne segue la materia. */
let serieScelta = leggiSerie(CHIAVE_SERIE, SERIE_DI_PARTENZA);
if (serieScelta === serieDelMaster) serieScelta = serieLibera(serieDelMaster);
const scena = new Scena(document.getElementById('tela')!, FISICA, trame, serieScelta, serieDelMaster);

/** Chi gioca cambia serie, dal pulsante o perché il master ha preso la sua. */
const cambiaSerie = (s: Serie) => {
  scena.scegliSerie(s);
  serieScelta = s;
  scriviSerie(CHIAVE_SERIE, s);
};

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
const ui = new Interfaccia(
  {
    lancia: (f, etichetta) => tavolo.tira(f, etichetta),
    lanciaRichiesta: tiraPerIlDm,
    pulisci: () => tavolo.pulisci(),
    scegliSerie: cambiaSerie,
  },
  serieScelta,
  serieDelMaster,
);
const suono = new Suono();
montaPulsanteDelSuono(document.getElementById('suono') as HTMLButtonElement, suono);
const ascolta: Ascoltatore = {
  urto: (u, di) => suono.colpo({ ...u, materia: MATERIA[di === 'master' ? serieDelMaster : serieScelta] }),
  inizio: () => ui.inizio(),
  ritiro: (frase) => ui.ritiro(frase),
  fine: (e) => {
    ui.fine(e);
    collegamento.invia(e);
  },
  fallito: (motivo) => ui.fallito(motivo),
  inizioDelMaster: (tiri) => ui.inizioDelMaster(tiri),
  fineDelMaster: (tiri, visto) => ui.fineDelMaster(tiri, visto),
  inizioPerChiGioca: (tiri) => ui.inizioPerChiGioca(tiri),
  finePerChiGioca: (tiri, visto) => ui.finePerChiGioca(tiri, visto),
};
const tavolo = new Tavolo(vassoio, scena, ascolta);
const collegamento = new Collegamento({
  // Il master prende la sua serie: i suoi dadi la vestono, e se era quella di chi gioca, chi gioca passa
  // alla serie dopo.
  dadiDelMaster: (s) => {
    serieDelMaster = s;
    scriviSerie(CHIAVE_SERIE_DEL_MASTER, s);
    scena.scegliSerieDelMaster(s);
    if (serieScelta === s) cambiaSerie(serieLibera(s));
    ui.serieDelMaster(s, serieScelta);
  },
  stato: (collegato, inCoda) => ui.stato(collegato, inCoda),
  richieste: (r) => ui.richieste(r),
  cronaca: (registrati, inCoda) => ui.cronaca(registrati, inCoda),
  registrato: (t) => ui.registrato(t),
  inRegistro: (id) => ui.inRegistro(id),
  respinto: (t, motivo) => ui.respinto(t, motivo),
  diventatoLibero: (t, requestId, problema) => ui.diventatoLibero(t, requestId, problema),
  // Con la ripresa i dadi del master rotolano sul vassoio; senza, i tiri vanno dritti in cronaca.
  lancioDelMaster: (tiri, ripresa) => (ripresa ? tavolo.riproduci(tiri, ripresa) : ui.fineDelMaster(tiri, false)),
  // Il master ha tirato al posto di chi gioca: gli stessi dadi di chi gioca, e il totale dove vanno i suoi.
  lancioPerChiGioca: (tiri, ripresa) => tavolo.riproduciPerChiGioca(tiri, ripresa),
  // Dietro lo schermo i dadi non si vedono: si sentono, attutiti.
  dietroLoSchermo: (t) => {
    suono.dietroLoSchermo();
    ui.dietroLoSchermo(t);
  },
});
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
