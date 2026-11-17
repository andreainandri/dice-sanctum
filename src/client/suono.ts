// Il suono dei dadi, sintetizzato: nessun campione registrato. Ogni urto ricavato dal moto dei dadi
// (physics/urti.ts) diventa un colpo breve, diverso per quello che il dado ha toccato: il fondo foderato
// (un tonfo sordo), il legno di sponde, scivoli e rampa (un colpo asciutto), un altro dado (un ticchettio
// di resina). La forza dell'urto fa il volume; dentro la torre il colpo suona chiuso nel legno.
// Il browser lascia suonare soltanto dopo un gesto di chi sta alla pagina: prima il suono tace.

import { type TipoUrto } from '../physics/urti.ts';
import { tr } from '../shared/lingua.ts';

/** Quante voci insieme: oltre, gli urti deboli si perdono nel mucchio e non si suonano. */
const VOCI_MASSIME = 20;
/** Sotto questa forza un urto in più, a voci piene, non si sente. */
const FORZA_CHE_PASSA = 0.45;
/** Il compressore prima dell'uscita: soglia in decibel, rapporto, attacco e rilascio in secondi. */
const COMPRESSORE = { soglia: -9, rapporto: 5, attacco: 0.003, rilascio: 0.1 } as const;
/** Quanto si alza il tutto prima del compressore: misurato perché un dado solo si senta bene e trenta non saturino. */
const GUADAGNO = 2.6;
const CHIAVE_VOLUME = 'dice-sanctum.volume';
const VOLUME_DI_SERIE = 0.7;

/** Un colpo: rumore filtrato che si spegne, più uno o due toni che si spengono con lui. */
interface Ricetta {
  /** Il filtro del rumore. */
  filtro: BiquadFilterType;
  frequenza: number;
  q: number;
  /** In quanto si spegne il rumore, in secondi. */
  codaRumore: number;
  rumore: number;
  /** I toni: frequenza di partenza e di arrivo, coda, volume. */
  toni: readonly { da: number; a: number; coda: number; volume: number }[];
  volume: number;
}

const RICETTE: Record<TipoUrto, Ricetta> = {
  // Feltro su legno: basso e corto, senza attacco.
  fondo: {
    filtro: 'lowpass',
    frequenza: 620,
    q: 0.7,
    codaRumore: 0.055,
    rumore: 0.9,
    toni: [{ da: 125, a: 72, coda: 0.085, volume: 0.75 }],
    volume: 0.85,
  },
  // Noce: un colpo asciutto, con due risonanze del legno.
  sponda: {
    filtro: 'bandpass',
    frequenza: 980,
    q: 2.2,
    codaRumore: 0.04,
    rumore: 0.8,
    toni: [
      { da: 430, a: 400, coda: 0.06, volume: 0.5 },
      { da: 690, a: 660, coda: 0.04, volume: 0.3 },
    ],
    volume: 0.8,
  },
  // Resina su resina: un tic acuto e brevissimo.
  dado: {
    filtro: 'bandpass',
    frequenza: 3400,
    q: 3.5,
    codaRumore: 0.016,
    rumore: 0.9,
    toni: [{ da: 2900, a: 2700, coda: 0.022, volume: 0.35 }],
    volume: 0.5,
  },
};

export interface Colpo {
  tipo: TipoUrto;
  /** Da 0 a 1. */
  forza: number;
  /** Dove, da sinistra (-1) a destra (1). */
  lato: number;
  /** Dietro lo schermo del master: attutito. */
  attutito?: boolean;
  /** Dentro la torre: il colpo suona chiuso nella cassa di legno. */
  nellaTorre?: boolean;
}

/**
 * La catena d'uscita, uguale nella pagina e nelle prove: il volume (alzato del guadagno), un compressore
 * perché molti colpi insieme non coprano tutto, e in fondo un limite morbido, che piega le punte senza
 * tagliarle: da lì non esce mai più di 1. Rende il nodo a cui si attaccano i colpi.
 */
function montaUscita(ctx: BaseAudioContext, volume: number): GainNode {
  const compressore = ctx.createDynamicsCompressor();
  compressore.threshold.value = COMPRESSORE.soglia;
  compressore.ratio.value = COMPRESSORE.rapporto;
  compressore.attack.value = COMPRESSORE.attacco;
  compressore.release.value = COMPRESSORE.rilascio;
  const limite = ctx.createWaveShaper();
  const curva = new Float32Array(1025);
  // La curva copre gli ingressi fra -3 e 3: fino a 0,5 passa quasi dritta, sopra piega verso 1.
  for (let i = 0; i < curva.length; i++) curva[i] = Math.tanh(((i / (curva.length - 1)) * 2 - 1) * 3);
  limite.curve = curva;
  limite.oversample = '2x';
  // Il limite legge il suo ingresso fra -1 e 1: lo si porta in quella scala.
  const scala = ctx.createGain();
  scala.gain.value = 1 / 3;
  const uscita = ctx.createGain();
  uscita.gain.value = volume * GUADAGNO;
  uscita.connect(compressore).connect(scala).connect(limite).connect(ctx.destination);
  return uscita;
}

/** Le voci che suonano insieme: ricorda quando finisce ognuna, e dice se un colpo nuovo ha posto. */
class Voci {
  private fine: number[] = [];

  /** Un colpo che parte a `quando`: a voci piene passa soltanto se è forte, e oltre il doppio non passa. */
  ammette(quando: number, forza: number): boolean {
    this.fine = this.fine.filter((t) => t > quando);
    if (this.fine.length >= VOCI_MASSIME * 2) return false;
    return this.fine.length < VOCI_MASSIME || forza >= FORZA_CHE_PASSA;
  }

  occupa(finoA: number): void {
    this.fine.push(finoA);
  }
}

/** Un secondo di rumore bianco, lo stesso per tutti i colpi: ognuno ne prende un pezzo a caso. */
function bufferDiRumore(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/**
 * Monta un colpo nel grafo audio, a partire dall'istante `quando`. Rende la sua durata in secondi.
 * Vale per il contesto vero e per quello fuori linea delle prove.
 */
export function montaColpo(ctx: BaseAudioContext, uscita: AudioNode, rumore: AudioBuffer, c: Colpo, quando: number): number {
  const r = RICETTE[c.tipo];
  const forza = Math.max(0, Math.min(1, c.forza));
  // Un urto forte è anche più chiaro e un po' più lungo; ogni colpo ha la sua piccola stonatura.
  const stona = 0.88 + Math.random() * 0.24;
  const chiaro = 0.75 + 0.5 * forza;
  const picco = r.volume * (0.16 + 0.84 * forza ** 1.2);
  const coda = (x: number) => x * (0.8 + 0.5 * forza);
  let durata = 0;

  let fine: AudioNode = uscita;
  if (c.attutito || c.nellaTorre) {
    const panno = ctx.createBiquadFilter();
    panno.type = 'lowpass';
    // Lo schermo del master toglie quasi tutto il chiaro; la cassa della torre soltanto la punta.
    panno.frequency.value = c.attutito ? 900 : 2600;
    panno.connect(uscita);
    fine = panno;
  }
  const lato = ctx.createStereoPanner();
  lato.pan.value = Math.max(-1, Math.min(1, c.lato)) * 0.6;
  lato.connect(fine);

  const sorgente = ctx.createBufferSource();
  sorgente.buffer = rumore;
  const filtro = ctx.createBiquadFilter();
  filtro.type = r.filtro;
  filtro.frequency.value = r.frequenza * stona * chiaro;
  filtro.Q.value = r.q;
  const inviluppo = ctx.createGain();
  const codaRumore = coda(r.codaRumore);
  inviluppo.gain.setValueAtTime(0, quando);
  inviluppo.gain.linearRampToValueAtTime(picco * r.rumore, quando + 0.0015);
  inviluppo.gain.exponentialRampToValueAtTime(0.0001, quando + codaRumore);
  sorgente.connect(filtro).connect(inviluppo).connect(lato);
  sorgente.start(quando, Math.random() * 0.8, codaRumore + 0.02);
  durata = Math.max(durata, codaRumore + 0.02);

  for (const t of r.toni) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const lunga = coda(t.coda);
    o.frequency.setValueAtTime(t.da * stona, quando);
    o.frequency.exponentialRampToValueAtTime(t.a * stona, quando + lunga);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, quando);
    g.gain.linearRampToValueAtTime(picco * t.volume, quando + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, quando + lunga);
    o.connect(g).connect(lato);
    o.start(quando);
    o.stop(quando + lunga + 0.02);
    durata = Math.max(durata, lunga + 0.02);
  }
  return durata;
}

function volumeRicordato(): number {
  try {
    const scritto = localStorage.getItem(CHIAVE_VOLUME);
    const v = scritto === null ? Number.NaN : Number(scritto);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : VOLUME_DI_SERIE;
  } catch {
    return VOLUME_DI_SERIE;
  }
}

export class Suono {
  private ctx: AudioContext | null = null;
  private uscita: GainNode | null = null;
  private rumore: AudioBuffer | null = null;
  private readonly voci = new Voci();
  private livello = volumeRicordato();

  /** Da 0 (muto) a 1. */
  get volume(): number {
    return this.livello;
  }

  set volume(v: number) {
    this.livello = Math.max(0, Math.min(1, Number.isFinite(v) ? v : VOLUME_DI_SERIE));
    if (this.uscita && this.ctx) this.uscita.gain.setTargetAtTime(this.livello * GUADAGNO, this.ctx.currentTime, 0.02);
    try {
      localStorage.setItem(CHIAVE_VOLUME, String(this.livello));
    } catch {
      // Senza memoria del browser il volume vale per questa visita.
    }
  }

  /** Vero quando il browser lascia suonare: dopo il primo gesto di chi sta alla pagina. */
  get sveglio(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Da chiamare in un gesto (un clic, un tasto): apre il suono, o lo riprende se il browser l'ha sospeso. */
  sblocca(): void {
    try {
      if (!this.ctx) {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        this.uscita = montaUscita(ctx, this.livello);
        this.ctx = ctx;
        this.rumore = bufferDiRumore(ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // Un browser senza audio: il tavolo resta muto.
      this.ctx = null;
    }
  }

  /** Suona un colpo fra `tra` secondi. Senza gesto, a volume zero o a voci piene tace. */
  colpo(c: Colpo, tra = 0): void {
    const { ctx, uscita, rumore } = this;
    if (!ctx || !uscita || !rumore || ctx.state !== 'running' || this.livello === 0) return;
    if (!(c.forza > 0)) return;
    const quando = ctx.currentTime + Math.max(0, tra);
    if (!this.voci.ammette(quando, c.forza)) return;
    this.voci.occupa(quando + montaColpo(ctx, uscita, rumore, c, quando));
  }

  /** I dadi del master dietro lo schermo: una manciata di colpi attutiti, senza dire quanti dadi sono. */
  dietroLoSchermo(durata = 0.9): void {
    const colpi = 16;
    for (let i = 0; i < colpi; i++) {
      const t = (i / colpi) * durata + Math.random() * 0.04;
      // I primi rimbalzi sono i più forti; in fondo i dadi si posano.
      const forza = 0.75 * (1 - i / colpi) ** 1.3 + 0.08;
      const tipo: TipoUrto = i % 3 === 0 ? 'dado' : i % 3 === 1 ? 'fondo' : 'sponda';
      this.colpo({ tipo, forza, lato: Math.random() * 0.6 - 0.3, attutito: true }, t);
    }
  }
}

const ICONA =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4z"/><path class="onde" d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/><path class="muto" d="M15.5 9.5l5 5M20.5 9.5l-5 5"/></svg>';

/**
 * Il pulsante del suono nella testata: lo accende e lo spegne, e ricorda la scelta. Il primo gesto ovunque
 * nella pagina sveglia il suono, come vuole il browser.
 */
export function montaPulsanteDelSuono(pulsante: HTMLButtonElement, suono: Suono): void {
  let prima = suono.volume > 0 ? suono.volume : VOLUME_DI_SERIE;
  const mostra = () => {
    const acceso = suono.volume > 0;
    pulsante.setAttribute('aria-pressed', String(acceso));
    pulsante.title = acceso ? tr({ it: 'Suono acceso: spegnilo', en: 'Sound on: turn it off' }) : tr({ it: 'Suono spento: accendilo', en: 'Sound off: turn it on' });
    pulsante.setAttribute('aria-label', pulsante.title);
  };
  pulsante.innerHTML = ICONA;
  pulsante.hidden = false;
  pulsante.addEventListener('click', () => {
    if (suono.volume > 0) {
      prima = suono.volume;
      suono.volume = 0;
    } else suono.volume = prima;
    mostra();
  });
  mostra();
  const sveglia = () => suono.sblocca();
  document.addEventListener('pointerdown', sveglia);
  document.addEventListener('keydown', sveglia);
}

/**
 * Per le prove: rende fuori linea una fila di colpi, ognuno al suo istante, al volume di serie e attraverso lo
 * stesso compressore dell'uscita vera. Rende il canale di sinistra e quello di destra, a 48.000 campioni al secondo.
 */
export async function rendiColpi(colpi: readonly { quando: number; colpo: Colpo }[], secondi: number): Promise<[Float32Array, Float32Array]> {
  const frequenza = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(frequenza * secondi), frequenza);
  const uscita = montaUscita(ctx, VOLUME_DI_SERIE);
  const rumore = bufferDiRumore(ctx);
  const voci = new Voci();
  for (const { quando, colpo } of [...colpi].sort((a, b) => a.quando - b.quando)) {
    if (!voci.ammette(quando, colpo.forza)) continue;
    voci.occupa(quando + montaColpo(ctx, uscita, rumore, colpo, quando));
  }
  const reso = await ctx.startRendering();
  return [reso.getChannelData(0), reso.getChannelData(1)];
}

/**
 * Per le prove: rende un colpo fuori linea e ne misura picco, energia e il centro dello spettro (in hertz,
 * dal conto dei passaggi per lo zero). Chi scrive il suono non lo può ascoltare: lo misura.
 */
export async function misuraColpo(c: Colpo): Promise<{ picco: number; rms: number; centro: number; durata: number }> {
  const frequenza = 48000;
  const ctx = new OfflineAudioContext(2, frequenza * 0.4, frequenza);
  const durata = montaColpo(ctx, ctx.destination, bufferDiRumore(ctx), c, 0.01);
  const reso = await ctx.startRendering();
  const s = reso.getChannelData(0);
  const d = reso.getChannelData(1);
  let picco = 0;
  let somma = 0;
  let zeri = 0;
  let primo = -1;
  let ultimo = 0;
  for (let i = 0; i < s.length; i++) {
    const x = (s[i]! + d[i]!) / 2;
    picco = Math.max(picco, Math.abs(x));
    somma += x * x;
    if (Math.abs(x) > 0.001) {
      if (primo < 0) primo = i;
      ultimo = i;
    }
    if (i > 0) {
      const prima = (s[i - 1]! + d[i - 1]!) / 2;
      if ((prima < 0 && x >= 0) || (prima >= 0 && x < 0)) zeri++;
    }
  }
  const suona = primo < 0 ? 0 : (ultimo - primo) / frequenza;
  return { picco, rms: Math.sqrt(somma / s.length), centro: suona > 0 ? zeri / 2 / suona : 0, durata: Math.max(durata, suona) };
}
