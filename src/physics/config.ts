// Parametri della fisica e soglie del tavolo. Unità: centimetri, secondi, grammi.
// Le prove di equità girano con questi stessi valori: cambiarli vuol dire rifarle.

export const FISICA = {
  /** Passo fisso della simulazione, staccato dai fotogrammi. */
  passo: 1 / 120,
  /**
   * Gravità ridotta di un terzo (981 il vero): un rallentatore del 23% che dà ai dadi il peso di
   * oggetti visti da vicino. Con 981 un dado solo si ferma in 0,5-0,7 s, con 650 in 0,6-1 s.
   */
  gravita: 650,
  /** Per Rapier: quante unità fanno un metro (tolleranze interne in scala). */
  unitaPerMetro: 100,
  /**
   * Il valore di serie di Rapier. Con 8, su migliaia di lanci, durate, ritiri e falliti erano gli
   * stessi, e il passo costava il 40% in più.
   */
  iterazioniSolutore: 4,

  vassoio: {
    larghezza: 30,
    profondita: 20,
    /**
     * Sponde visibili, solo disegno: basse perché quella vicina non nasconda i dadi fermi contro di
     * lei. Le sponde della fisica sono piani alti fino al coperchio.
     */
    sponda: 1.8,
    spessore: 2,
    /** Il coperchio invisibile: tiene i dadi dentro. */
    coperchio: 16,
  },

  dado: {
    /** Resina: 1,2 g/cm³. */
    densita: 1.2,
    /** Sopra 0,38 un d20 che striscia su una faccia si ribalta sullo spigolo e rotola. */
    attrito: 0.5,
    rimbalzo: 0.5,
    smorzamentoLineare: 0.02,
    smorzamentoAngolare: 0.05,
  },
  fondo: { attrito: 0.6, rimbalzo: 0.5 },
  sponde: { attrito: 0.3, rimbalzo: 0.6 },

  lancio: {
    /** Fascia di partenza, dal bordo del lato scelto verso il centro. */
    fascia: 8,
    altezzaMinima: 5,
    passoGriglia: 3,
    velocitaMinima: 50,
    velocitaMassima: 100,
    /** Velocità verso il basso al rilascio. */
    caduta: 20,
    /** Deviazione massima dalla direzione del centro, in gradi. */
    deviazione: 25,
    /** Radianti al secondo: da cinque a dieci giri, come da una mano. */
    rotazioneMinima: 30,
    rotazioneMassima: 65,
    /** Scarto casuale della posizione dentro la cella: col passo da 3 cm i dadi non nascono compenetrati (il d6 ha raggio 1,39). */
    scarto: 0.1,
    /** Il ritiro cade dall'alto sopra il punto più libero, con poca spinta di lato. */
    altezzaRitiro: 7,
    spintaRitiroMinima: 10,
    spintaRitiroMassima: 40,
  },

  fermo: {
    /** Sotto queste velocità, per questa durata, il dado è fermo. */
    velocitaLineare: 0.5,
    velocitaAngolare: 0.06,
    durata: 0.25,
  },
  /** Oltre questo angolo fra la faccia di lettura e la verticale il dado è storto, in gradi. */
  tolleranzaStorto: 6,
  /** Un dado che si muove da più di tanto senza fermarsi si ritira. */
  tempoMassimoDado: 6,
  /** Ritiri ammessi per dado: se ne servirebbe un terzo, il tiro fallisce. */
  ritiriMassimi: 2,
  /** Oltre questo margine dal vassoio il dado è uscito. */
  margineUscita: 1,
  /** Rete di sicurezza per l'intero tiro. */
  tempoMassimoTiro: 40,
} as const;

export type ConfigFisica = typeof FISICA;
