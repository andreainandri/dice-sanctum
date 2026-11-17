// Parametri della fisica e soglie del tavolo. Unità: centimetri, secondi, grammi.
// Le prove di equità girano con questi stessi valori: cambiarli vuol dire rifarle.

export const FISICA = {
  /** Passo fisso della simulazione, staccato dai fotogrammi. */
  passo: 1 / 120,
  /** La gravità vera, in cm/s². */
  gravita: 981,
  /** Per Rapier: quante unità fanno un metro (tolleranze interne in scala). */
  unitaPerMetro: 100,
  /**
   * Il valore di serie di Rapier. Con 8, su migliaia di lanci, durate, ritiri e falliti erano gli
   * stessi, e il passo costava il 40% in più.
   */
  iterazioniSolutore: 4,
  /**
   * Fin dove Rapier prepara un contatto prima che due corpi si tocchino, in centimetri. Di serie sarebbero
   * 2 (0,02 per l'unità), più del raggio di un dado. Fra due gusci (dado e dado, dado e torre) Rapier 0.21
   * non rifà il contatto a ogni passo: quello preparato a distanza resta com'era anche quando i due si sono
   * allontanati, e il solutore lo tratta come un piano fermo nello spazio. Con 2 cm un d4 su sei si fermava a
   * metà rampa contro il piano lasciato dallo scivolo sotto cui era appena passato (spento quello scivolo
   * ripartiva; in un mondo nuovo, nella stessa posa, scivolava). Con 0,2 cm i contatti nascono soltanto a
   * dadi quasi a contatto: su 300 lanci nessun d4 fermo nella torre, nessun dado attraverso una parete.
   */
  previsione: 0.2,

  /**
   * Il vassoio intero: in fondo la torre, davanti la corte, dove i dadi escono, rotolano e si leggono.
   * La corte è larga quanto il vassoio e profonda quanto resta: 30 per 20 cm.
   */
  vassoio: {
    larghezza: 30,
    profondita: 30,
    /**
     * Le sponde che si vedono, solo disegno; quelle della fisica sono piani alti fino al coperchio.
     * Basse: i dadi escono dalla torre rasoterra, e la sponda dalla parte di chi guarda non deve
     * nascondere i dadi fermi contro di lei (oltre 2,2 cm coprirebbe la cifra di un d8).
     */
    sponda: 2,
    spessore: 2,
    /** Il coperchio invisibile, sopra il punto da cui i dadi cadono nella torre (31 cm dal fondo). */
    coperchio: 36,
  },

  /**
   * La torre dei dadi, lungo il lato di fondo del vassoio e larga quanto lui: chi guarda ne vede la
   * facciata. I dadi cadono nella bocca, scendono da uno scivolo all'altro, che sporgono a turno dalle due
   * pareti, e la rampa li porta fuori dall'arco, verso chi guarda, sparsi per tutta la larghezza della corte.
   * Con l'arco lungo 30 cm trenta dadi escono senza fare calca: una torre a scatola, con l'arco di 8,5 cm,
   * falliva 94 tiri su 100. Misure interne, in centimetri; le quote degli scivoli le ricava `misureTorre`
   * dal basso.
   */
  torre: {
    /** La canna, dalla sponda di fondo alla parete verso la corte. */
    profonda: 9,
    /** Spessore della parete verso la corte. */
    parete: 1,
    /** L'arco d'uscita, lungo quanto la torre: alto tanto. */
    arco: 5.5,
    /** La rampa d'uscita: parte dalla sponda di fondo a questa quota e arriva al piano della corte sotto l'arco. */
    rampa: 6.5,
    /**
     * Gli scivoli, dal basso: la parete da cui sporgono, di quanto sporgono e di quanto scendono fino al
     * labbro. Fra il labbro e la parete di fronte restano 4,6 cm: passa il dado più grande (il d6, 3,3 cm
     * fra due vertici opposti) con più di un centimetro di gioco. Ogni scivolo allunga il tiro di 0,13 s e
     * alza la torre di 5 cm, che da chi guarda non si vedono: la torre sale oltre il riquadro. Con quattro
     * un d20 si ferma in 1,5 s (1,2 con due, 0,9 senza torre) ed esce dall'arco dopo 0,7; trenta dadi in 2,9.
     */
    scivoli: [
      { da: 'corte', sporge: 4.4, scende: 2.4 },
      { da: 'fondo', sporge: 4.4, scende: 2.4 },
      { da: 'corte', sporge: 4.4, scende: 2.4 },
      { da: 'fondo', sporge: 4.4, scende: 2.4 },
    ] as readonly { da: 'fondo' | 'corte'; sporge: number; scende: number }[],
    /** Lo spazio in verticale sotto il labbro di ogni scivolo. */
    luce: 4.6,
    /** Spessore degli scivoli al labbro. */
    labbro: 0.4,
    /** Dalla cima dello scivolo più alto all'orlo della bocca. */
    orlo: 1.5,
    /** Legno liscio: i dadi scivolano (attrito medio col dado 0,2) e rimbalzano meno che sul fondo. */
    attrito: 0.2,
    rimbalzo: 0.4,
  },

  dado: {
    /** Resina: 1,2 g/cm³. */
    densita: 1.2,
    /**
     * Rapier fa la media degli attriti dei due corpi. Fra dado e dado 0,2, resina su resina: scivolano
     * l'uno sull'altro e si posano di piatto, senza restare appoggiati storti. Col fondo la media è 0,425:
     * sopra 0,38 un d20 che striscia su una faccia si ribalta sullo spigolo e rotola.
     */
    attrito: 0.2,
    rimbalzo: 0.75,
    smorzamentoLineare: 0.02,
    smorzamentoAngolare: 0.05,
  },
  fondo: { attrito: 0.65, rimbalzo: 0.75 },
  sponde: { attrito: 0.2, rimbalzo: 0.75 },

  /** I dadi si versano nella bocca della torre a ondate: ognuna occupa le celle della bocca, una per dado. */
  lancio: {
    /** Da quanto sopra l'orlo della bocca cadono. */
    sopraLOrlo: 3.5,
    /** Quanti dadi al più per ondata (le celle della bocca sono 16), e ogni quanti secondi parte un'ondata. */
    onda: 16,
    intervallo: 0.14,
    /** Il lato della cella: col passo da 3,5 cm i dadi non nascono compenetrati (il d6 ha raggio 1,65). */
    passoGriglia: 3.5,
    /** Dal centro di una cella alle pareti della bocca. */
    gioco: 2,
    /** Scarto casuale della posizione dentro la cella. */
    scarto: 0.1,
    /** Velocità verso il basso al rilascio, e di lato in una direzione a caso. */
    cadutaMinima: 40,
    cadutaMassima: 90,
    deriva: 25,
    /** Radianti al secondo: da tre a dieci giri. */
    rotazioneMinima: 20,
    rotazioneMassima: 65,
    /** Un dado che aspetta la sua ondata sta tanto più in alto, dove nessuna inquadratura arriva. */
    parcheggio: 40,
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
  /**
   * Ritiri ammessi per dado: se ne servirebbe un altro, il tiro fallisce. Tre, perché nella corte piena
   * un dado ritirato torna a posarsi contro gli altri: trenta dadi fanno più di un ritiro a tiro, e con
   * due soli ammessi fallivano 17 tiri su 400 (misurato con una corte da 20 per 20).
   */
  ritiriMassimi: 3,
  /** Oltre questo margine dal vassoio il dado è uscito. */
  margineUscita: 1,
  /** Rete di sicurezza per l'intero tiro. */
  tempoMassimoTiro: 40,
} as const;

export type ConfigFisica = typeof FISICA;
