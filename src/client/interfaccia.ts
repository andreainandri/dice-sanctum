// L'interfaccia intorno al vassoio: il pannello dei dadi, il campo della formula, i pulsanti,
// i tasti, la cronaca e il risultato grande. Non lancia niente da sé: chiama le sue azioni.

import {
  type RichiestaCreata,
  type TiroCompletato,
  type TiroCoperto,
  type TiroDalTavolo,
  type TiroDelMaster,
  type VoceDiCronaca,
} from '../shared/eventi.ts';
import { type Lingua, impostaLingua, lingua, linguaDa, tr } from '../shared/lingua.ts';
import {
  ErroreFormula,
  type Formula,
  LATI,
  type Lati,
  type Vantaggio,
  aggiungiDado,
  conVantaggio,
  contaPerLati,
  leggiFormula,
} from '../shared/notazione.ts';
import { type ProblemaRichiesta } from '../shared/protocollo.ts';
import { SERIE_DEL_GIOCATORE, type SerieDelGiocatore } from './facce.ts';

/**
 * L'ora dell'ultimo PULISCI, in millisecondi: da lì la cronaca mostra soltanto i tiri venuti dopo, anche
 * a pagina ricaricata. Il registro non si tocca: il DM continua a leggerci tutto.
 */
const CHIAVE_PULITA = 'dice-sanctum.cronaca-pulita';

function leggiPulitura(): number {
  try {
    const n = Number(localStorage.getItem(CHIAVE_PULITA) ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function elemento<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`manca #${id} nella pagina`);
  return e as T;
}

function crea<K extends keyof HTMLElementTagNameMap>(tag: K, classe?: string, testo?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (testo !== undefined) e.textContent = testo;
  return e;
}

/** L'ora di una voce: all'italiana in italiano, in inglese come la vuole il browser. */
const ora = (iso: string) =>
  new Date(iso).toLocaleTimeString(lingua() === 'it' ? 'it-IT' : undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * La lingua della pagina, prima di tutto il resto: `?lingua=it` o `?lingua=en` nell'indirizzo, altrimenti
 * quella del browser. Mette i testi fissi e mostra la pagina, che fino a qui resta nascosta: così la
 * lingua sbagliata non compare mai, nemmeno per un attimo.
 */
export function preparaLingua(): void {
  const scelta = new URLSearchParams(location.search).get('lingua');
  impostaLingua(scelta === 'it' || scelta === 'en' ? scelta : linguaDa(navigator.languages?.length ? navigator.languages : [navigator.language]));
  document.documentElement.lang = lingua();
  const testo = (selettore: string, t: Record<Lingua, string>) => {
    const e = document.querySelector(selettore);
    if (e) e.textContent = tr(t);
  };
  const attributo = (id: string, nome: string, t: Record<Lingua, string>) => elemento(id).setAttribute(nome, tr(t));
  testo('#stato', { it: 'scollegato', en: 'disconnected' });
  testo('#apri-cronaca', { it: 'Cronaca', en: 'Chronicle' });
  testo('#dadi h2', { it: 'Dadi', en: 'Dice' });
  attributo('dadi', 'aria-label', { it: 'Dadi', en: 'Dice' });
  testo('#caricamento', { it: 'preparo il tavolo…', en: 'setting the table…' });
  testo('#cronaca h2', { it: 'Cronaca', en: 'Chronicle' });
  attributo('cronaca', 'aria-label', { it: 'Cronaca', en: 'Chronicle' });
  attributo('formula', 'placeholder', { it: 'formula, per esempio 1d20+5', en: 'formula, e.g. 1d20+5' });
  attributo('etichetta', 'placeholder', { it: 'etichetta (facoltativa)', en: 'label (optional)' });
  testo('#tira', { it: 'TIRA', en: 'ROLL' });
  testo('#vantaggio', { it: 'VANTAGGIO', en: 'ADVANTAGE' });
  testo('#svantaggio', { it: 'SVANTAGGIO', en: 'DISADVANTAGE' });
  testo('#pulisci', { it: 'PULISCI', en: 'CLEAR' });
  document.documentElement.classList.add('pronta');
}

/** Perché una richiesta del DM non c'era più, quando il suo tiro è arrivato al ponte. */
const PROBLEMI: Record<ProblemaRichiesta, Record<Lingua, string>> = {
  sconosciuta: { it: 'richiesta sconosciuta', en: 'unknown request' },
  soddisfatta: { it: 'richiesta già soddisfatta', en: 'request already answered' },
  annullata: { it: 'richiesta annullata', en: 'request cancelled' },
};

/** I nomi delle serie di dadi fra cui sceglie chi gioca. */
const NOME_SERIE: Record<SerieDelGiocatore, () => string> = {
  perla: () => tr({ it: 'Perla azzurra', en: 'Azure Pearl' }),
  ossidiana: () => tr({ it: 'Ossidiana e oro', en: 'Obsidian & Gold' }),
};
const NATURALE_20 = () => tr({ it: 'NATURALE 20', en: 'NATURAL 20' });
const NATURALE_1 = () => tr({ it: 'NATURALE 1', en: 'NATURAL 1' });

/** Il profilo di ogni dado, a filo, su una griglia di 24: il contorno e gli spigoli che si vedono di fronte. */
const PROFILI: Record<Lati, string[]> = {
  4: ['M12 3 21.5 19.5H2.5Z', 'M12 3v16.5'],
  6: ['M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5Z', 'M3.5 7.25 12 12l8.5-4.75M12 12v9.5'],
  8: ['M12 2.5 20 12l-8 9.5L4 12Z', 'M4 12h16M12 2.5 9 12l3 9.5'],
  10: ['M12 2 20.5 10 12 22 3.5 10Z', 'M3.5 10 12 13.5 20.5 10M12 13.5V22'],
  12: ['M12 2.5 21.5 9.4l-3.6 11.1H6.1L2.5 9.4Z', 'M12 7.2l4.6 3.3-1.8 5.4H9.2l-1.8-5.4ZM12 2.5v4.7M21.5 9.4l-4.9 1.1M17.9 20.5l-3.1-4.6M6.1 20.5l3.1-4.6M2.5 9.4l4.9 1.1'],
  20: ['M12 2 20.7 7v10L12 22l-8.7-5V7Z', 'M12 7.5l4.3 7.5H7.7ZM12 2v5.5M20.7 7l-4.4 8M20.7 17l-4.4-2M12 22l-4.3-7M3.3 17l4.4-2M3.3 7l4.4 8M12 22l4.3-7'],
  100: ['M7 3 11.5 9 7 16 2.5 9Z', 'M17 8l4.5 6-4.5 7-4.5-7Z', 'M2.5 9 7 11l4.5-2M7 11v5M12.5 14l4.5 2 4.5-2M17 16v5'],
};

function icona(lati: Lati): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('stroke-linejoin', 'round');
  PROFILI[lati].forEach((d, i) => {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    // Il contorno pieno, gli spigoli di dentro (l'ultimo tratto) più leggeri.
    if (i > 0 && i === PROFILI[lati].length - 1) p.setAttribute('stroke-opacity', '0.55');
    svg.append(p);
  });
  return svg;
}

/** Il segno davanti a un gruppo o a un numero: niente davanti al primo positivo. */
const segnoDi = (segno: number, primo: boolean) => (segno < 0 ? (primo ? '-' : ' - ') : primo ? '' : ' + ');

/** I dadi del tiro come nodi: gli scartati attenuati, il d100 con le sue parti nel suggerimento. */
function dadiDelTiro(e: TiroDalTavolo | TiroCompletato | TiroDelMaster): DocumentFragment {
  const f = document.createDocumentFragment();
  e.groups.forEach((g, gi) => {
    f.append(segnoDi(g.sign, gi === 0), '[');
    g.dice.forEach((d, di) => {
      if (di > 0) f.append(' ');
      const s = crea('span', d.kept ? 'dado-tenuto' : 'dado-scartato', String(d.value));
      if (d.tens !== undefined) {
        const decine = String(d.tens).padStart(2, '0');
        s.title = tr({ it: `decine ${decine}, unità ${d.units}`, en: `tens ${decine}, units ${d.units}` });
      }
      if (d.rethrows > 0) {
        const volte =
          d.rethrows === 1
            ? tr({ it: 'ritirato una volta', en: 'rolled again once' })
            : tr({ it: `ritirato ${d.rethrows} volte`, en: `rolled again ${d.rethrows} times` });
        s.title = s.title ? `${s.title}; ${volte}` : volte;
      }
      f.append(s);
    });
    f.append(']');
  });
  if (e.constant !== 0) f.append(segnoDi(Math.sign(e.constant), false).trimEnd() + ' ' + Math.abs(e.constant));
  return f;
}

/** Quello che l'interfaccia chiede al tavolo. */
export interface Azioni {
  lancia(f: Formula, etichetta: string): Promise<unknown>;
  /** Tira esattamente la formula di una richiesta del DM, con la sua etichetta. */
  lanciaRichiesta(r: RichiestaCreata): Promise<unknown>;
  pulisci(): void;
  /** Chi gioca cambia la serie dei suoi dadi. */
  scegliSerie(serie: SerieDelGiocatore): void;
}

export class Interfaccia {
  private readonly campo = elemento<HTMLInputElement>('formula');
  private readonly etichetta = elemento<HTMLInputElement>('etichetta');
  private readonly errore = elemento<HTMLDivElement>('errore');
  private readonly pannello = elemento<HTMLElement>('dadi');
  private readonly voci = elemento<HTMLOListElement>('voci');
  private readonly risultato = elemento<HTMLDivElement>('risultato');
  private readonly avviso = elemento<HTMLDivElement>('avviso');
  private readonly statoPonte = elemento<HTMLDivElement>('stato');
  private readonly banner = elemento<HTMLDivElement>('richieste');
  private readonly pulsantiTiro: HTMLButtonElement[];
  private readonly quanti = new Map<Lati, HTMLSpanElement>();
  private readonly azioni: Azioni;
  private inCorso = false;
  private richiesteMostrate: readonly RichiestaCreata[] = [];
  /** Senza localStorage vale finché la pagina resta aperta. */
  private pulitaAlle = leggiPulitura();

  constructor(azioni: Azioni, serie: SerieDelGiocatore) {
    this.azioni = azioni;
    this.costruisciPannello();
    this.costruisciSerie(serie);
    const tira = elemento<HTMLButtonElement>('tira');
    const vantaggio = elemento<HTMLButtonElement>('vantaggio');
    const svantaggio = elemento<HTMLButtonElement>('svantaggio');
    const pulisci = elemento<HTMLButtonElement>('pulisci');
    this.pulsantiTiro = [tira, vantaggio, svantaggio, pulisci];
    tira.addEventListener('click', () => this.tiraDalCampo());
    vantaggio.addEventListener('click', () => this.tiraDalCampo('vantaggio'));
    svantaggio.addEventListener('click', () => this.tiraDalCampo('svantaggio'));
    // Sgombra il tavolo: i dadi dal vassoio, la scelta dal campo, il totale dalla targa e la cronaca.
    pulisci.addEventListener('click', () => {
      this.azioni.pulisci();
      this.campo.value = '';
      this.etichetta.value = '';
      this.mostraErrore(null);
      this.aggiornaPannello();
      this.sgombra();
    });
    this.campo.addEventListener('input', () => {
      this.mostraErrore(null);
      this.aggiornaPannello();
    });
    for (const c of [this.campo, this.etichetta]) {
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.tiraDalCampo();
        }
      });
    }
    // Lo spazio tira da ovunque fuori dai campi di testo; i pulsanti non tengono il fuoco.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      this.tiraDalCampo();
    });
    // Nelle finestre strette la cronaca è un pannello che entra da destra: lo apre e lo chiude il suo
    // pulsante nella testata, lo chiude anche Esc.
    const apri = elemento<HTMLButtonElement>('apri-cronaca');
    const cronacaAperta = (si: boolean) => {
      document.body.classList.toggle('cronaca-aperta', si);
      apri.setAttribute('aria-expanded', String(si));
    };
    apri.addEventListener('click', () => cronacaAperta(!document.body.classList.contains('cronaca-aperta')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cronacaAperta(false);
    });
    for (const b of document.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
    this.aggiornaPannello();
  }

  /** In fondo al pannello dei dadi, la scelta della serie: un pulsante per serie, col suo campione di colore. */
  private costruisciSerie(scelta: SerieDelGiocatore): void {
    const gruppo = crea('div', 'serie');
    gruppo.setAttribute('role', 'radiogroup');
    const titolo = tr({ it: 'Serie', en: 'Set' });
    gruppo.setAttribute('aria-label', titolo);
    gruppo.append(crea('h3', undefined, titolo));
    const pulsanti = SERIE_DEL_GIOCATORE.map((serie) => {
      const b = crea('button', 'scelta');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.title = NOME_SERIE[serie]();
      b.append(crea('span', `campione ${serie}`), crea('span', 'nome-serie', NOME_SERIE[serie]()));
      b.addEventListener('click', () => {
        segna(serie);
        this.azioni.scegliSerie(serie);
      });
      gruppo.append(b);
      return { serie, b };
    });
    const segna = (quale: SerieDelGiocatore) => {
      for (const { serie, b } of pulsanti) b.setAttribute('aria-checked', String(serie === quale));
    };
    segna(scelta);
    this.pannello.append(gruppo);
  }

  private costruisciPannello(): void {
    for (const lati of LATI) {
      const riga = crea('div', 'dado');
      const nome = crea('button', 'nome', `d${lati}`);
      nome.prepend(icona(lati));
      nome.type = 'button';
      const aggiungi = tr({ it: `aggiungi un d${lati}`, en: `add a d${lati}` });
      nome.title = aggiungi;
      const quanti = crea('span', 'quanti', '0');
      const meno = crea('button', 'meno', '−');
      meno.type = 'button';
      meno.title = tr({ it: `togli un d${lati}`, en: `remove a d${lati}` });
      const piu = crea('button', 'piu', '+');
      piu.type = 'button';
      piu.title = aggiungi;
      nome.addEventListener('click', () => this.cambia(lati, 1));
      piu.addEventListener('click', () => this.cambia(lati, 1));
      meno.addEventListener('click', () => this.cambia(lati, -1));
      riga.append(nome, quanti, meno, piu);
      this.pannello.append(riga);
      this.quanti.set(lati, quanti);
    }
  }

  private cambia(lati: Lati, delta: 1 | -1): void {
    try {
      this.campo.value = aggiungiDado(this.campo.value, lati, delta);
      this.mostraErrore(null);
    } catch (e) {
      this.mostraErrore(e);
    }
    this.aggiornaPannello();
  }

  /** Il pannello si ricava dal campo: quanti dadi di ogni tipo dice la formula scritta. */
  private aggiornaPannello(): void {
    let conta: Map<Lati, number> | null = null;
    try {
      conta = contaPerLati(this.campo.value);
    } catch {
      conta = null;
    }
    for (const [lati, s] of this.quanti) {
      s.textContent = conta ? String(conta.get(lati) ?? 0) : '·';
      s.classList.toggle('zero', !conta || !conta.get(lati));
    }
  }

  private mostraErrore(e: unknown): void {
    if (e === null) {
      this.errore.textContent = '';
      return;
    }
    this.errore.textContent = e instanceof Error ? e.message : String(e);
    if (e instanceof ErroreFormula && document.activeElement === this.campo) {
      const p = Math.min(e.posizione, this.campo.value.length);
      this.campo.setSelectionRange(p, Math.min(p + 1, this.campo.value.length));
    }
  }

  private tiraDalCampo(quale?: Vantaggio): void {
    let f: Formula;
    try {
      if (!quale && this.campo.value.trim() === '') throw new Error(tr({ it: 'scrivi una formula o scegli i dadi', en: 'type a formula or pick the dice' }));
      f = quale ? conVantaggio(this.campo.value, quale) : leggiFormula(this.campo.value);
    } catch (e) {
      this.mostraErrore(e);
      return;
    }
    this.mostraErrore(null);
    this.azioni.lancia(f, this.etichetta.value.trim()).catch(() => {
      // Il motivo arriva già all'avviso sul vassoio.
    });
  }

  inizio(): void {
    this.inCorso = true;
    for (const b of this.pulsantiTiro) b.disabled = true;
    for (const b of this.banner.querySelectorAll('button')) b.disabled = true;
    document.body.classList.add('in-corso');
    this.risultato.hidden = true;
    this.avviso.hidden = true;
    this.avviso.classList.remove('del-master', 'per-chi-gioca');
    this.avviso.replaceChildren();
  }

  ritiro(frase: string): void {
    this.avviso.hidden = false;
    this.avviso.classList.remove('grave');
    this.avviso.append(crea('div', undefined, frase));
  }

  /** Gli avvisi dei ritiri restano fino al tiro dopo: dicono perché un dado è saltato. */
  fine(e: TiroDalTavolo): void {
    this.libera();
    this.mostraRisultato(e);
    this.aggiungiCronaca(e, true);
  }

  /** I dadi del master rotolano: sul vassoio si legge chi tira che cosa, il numero arriva a dadi fermi. */
  inizioDelMaster(tiri: readonly TiroDelMaster[]): void {
    this.inizio();
    this.avviso.hidden = false;
    this.avviso.classList.remove('grave');
    this.avviso.classList.add('del-master');
    const riga = crea('div');
    riga.append(crea('span', 'chi', tr({ it: 'Il master tira: ', en: 'The DM rolls: ' })), tiri.map((t) => t.label).join(' · '));
    this.avviso.append(riga);
  }

  /** I dadi del master sono fermi (o non si potevano mostrare): il risultato e le voci della cronaca. */
  fineDelMaster(tiri: readonly TiroDelMaster[], visto: boolean): void {
    if (visto) {
      this.libera();
      this.avviso.hidden = true;
      this.avviso.classList.remove('del-master');
      this.avviso.replaceChildren();
      this.mostraRisultatoDelMaster(tiri);
    }
    for (const t of tiri) this.aggiungiCronaca(t);
  }

  /** Il master tira al posto di chi gioca: sul vassoio si legge che cosa, il numero arriva a dadi fermi. */
  inizioPerChiGioca(tiri: readonly TiroCompletato[]): void {
    this.inizio();
    this.avviso.hidden = false;
    this.avviso.classList.remove('grave');
    this.avviso.classList.add('per-chi-gioca');
    const riga = crea('div');
    riga.append(crea('span', 'chi', tr({ it: 'Il master tira per te: ', en: 'The DM rolls for you: ' })), tiri.map((t) => t.label).join(' · '));
    this.avviso.append(riga);
  }

  /** I dadi tirati al posto di chi gioca sono fermi: il totale dove vanno i suoi tiri, e le voci della cronaca. */
  finePerChiGioca(tiri: readonly TiroCompletato[], visto: boolean): void {
    if (visto) {
      this.libera();
      this.avviso.hidden = true;
      this.avviso.classList.remove('per-chi-gioca');
      this.avviso.replaceChildren();
      if (tiri.length === 1) this.mostraRisultato(tiri[0]!);
      else this.mostraInFila(tiri, false);
    }
    for (const t of tiri) this.aggiungiCronaca(t);
  }

  /** Il master ha tirato dietro lo schermo: una voce senza numeri. */
  dietroLoSchermo(t: TiroCoperto): void {
    this.aggiungiCronaca(t);
  }

  fallito(motivo: string): void {
    this.libera();
    this.avviso.hidden = false;
    this.avviso.classList.add('grave');
    this.avviso.replaceChildren(crea('div', undefined, motivo));
  }

  private libera(): void {
    this.inCorso = false;
    for (const b of this.pulsantiTiro) b.disabled = false;
    for (const b of this.banner.querySelectorAll('button')) b.disabled = false;
    document.body.classList.remove('in-corso');
  }

  /** Il risultato grande sopra il vassoio, fino al tiro dopo: totale e naturale. Formula e dadi stanno nella cronaca. */
  mostraRisultato(e: TiroDalTavolo): void {
    const r = this.risultato;
    r.replaceChildren();
    r.classList.remove('del-master', 'piu-tiri');
    r.classList.toggle('nat20', e.nat20);
    r.classList.toggle('nat1', e.nat1);
    r.append(crea('div', 'totale', String(e.total)));
    if (e.nat20) r.append(crea('div', 'naturale', NATURALE_20()));
    if (e.nat1) r.append(crea('div', 'naturale', NATURALE_1()));
    r.hidden = false;
  }

  /** Il risultato di un lancio del master: ogni tiro con la sua etichetta e il suo totale. */
  private mostraRisultatoDelMaster(tiri: readonly TiroDelMaster[]): void {
    this.mostraInFila(tiri, true);
  }

  /**
   * Più tiri di un lancio solo in fila sulla targa, ognuno con l'etichetta sopra il totale: quelli del
   * master sotto il suo nome, quelli che il master ha tirato al posto di chi gioca senza.
   */
  private mostraInFila(tiri: readonly (TiroDelMaster | TiroCompletato)[], delMaster: boolean): void {
    const r = this.risultato;
    r.replaceChildren();
    r.classList.remove('nat20', 'nat1');
    r.classList.add('piu-tiri');
    r.classList.toggle('del-master', delMaster);
    if (delMaster) r.append(crea('div', 'chi', tr({ it: 'Il master', en: 'The DM' })));
    const righe = crea('div', tiri.length === 1 ? 'tiri uno' : tiri.length > 4 ? 'tiri molti' : 'tiri');
    for (const t of tiri) {
      const tiro = crea('div', 'tiro');
      if (t.nat20) tiro.classList.add('nat20');
      if (t.nat1) tiro.classList.add('nat1');
      tiro.append(crea('span', 'etichetta', t.label), crea('span', 'totale', String(t.total)));
      if (t.nat20) tiro.append(crea('span', 'naturale', NATURALE_20()));
      if (t.nat1) tiro.append(crea('span', 'naturale', NATURALE_1()));
      righe.append(tiro);
    }
    r.append(righe);
    r.hidden = false;
  }

  /** La voce di un lancio del master dietro lo schermo. */
  private voceCoperta(e: TiroCoperto): HTMLLIElement {
    const li = crea('li', 'voce del-master coperta');
    li.dataset.id = e.id;
    const testa = crea('div', 'testa');
    testa.append(crea('time', undefined, ora(e.at)), crea('span', 'etichetta', tr({ it: 'Il master tira dietro lo schermo', en: 'The DM rolls behind the screen' })));
    li.append(testa);
    return li;
  }

  /** Una voce della cronaca. `inCoda`: il tiro non è ancora nel registro. */
  private voce(e: TiroDalTavolo | VoceDiCronaca, inCoda: boolean, nota?: string): HTMLLIElement {
    if (e.type === 'dm.roll.hidden') return this.voceCoperta(e);
    const delMaster = e.type === 'dm.roll.completed';
    const chiesto = e.type === 'roll.completed' && e.requestId !== null;
    const li = crea('li', 'voce');
    li.dataset.id = e.id;
    if (e.nat20) li.classList.add('nat20');
    if (e.nat1) li.classList.add('nat1');
    if (chiesto) li.classList.add('dal-dm');
    if (delMaster) li.classList.add('del-master');
    if (inCoda) li.classList.add('in-coda');
    const testa = crea('div', 'testa');
    testa.append(crea('time', undefined, ora(e.at)));
    if (e.label) testa.append(crea('span', 'etichetta', e.label));
    testa.append(crea('span', 'formula', e.formula));
    const corpo = crea('div', 'corpo');
    corpo.append(dadiDelTiro(e), ' = ', crea('strong', 'totale', String(e.total)));
    li.append(testa, corpo);
    const note: string[] = [];
    if (e.nat20) note.push(NATURALE_20());
    if (e.nat1) note.push(NATURALE_1());
    if (chiesto) note.push(tr({ it: 'chiesto dal DM', en: 'asked by the DM' }));
    if (delMaster) note.push(tr({ it: 'tiro del master', en: 'rolled by the DM' }));
    if (e.type === 'roll.completed' && e.rolledBy === 'dm') note.push(tr({ it: 'tirato dal master per te', en: 'rolled by the DM for you' }));
    if (note.length) li.append(crea('div', 'note', note.join(' · ')));
    if (nota) li.append(crea('div', 'nota-ponte', nota));
    // Si vede soltanto da scollegati: da collegati un tiro resta in coda pochi millisecondi.
    if (inCoda) li.append(crea('div', 'attesa', tr({ it: 'in coda: arriva al DM quando il ponte risponde', en: 'queued: it reaches the DM when the bridge answers' })));
    return li;
  }

  /** Una voce in cima alla cronaca. */
  aggiungiCronaca(e: TiroDalTavolo | VoceDiCronaca, inCoda = false): void {
    this.voci.querySelector(`li[data-id="${CSS.escape(e.id)}"]`)?.remove();
    this.voci.prepend(this.voce(e, inCoda));
    while (this.voci.children.length > 300) this.voci.lastElementChild?.remove();
  }

  private voceDi(id: string): HTMLLIElement | null {
    return this.voci.querySelector<HTMLLIElement>(`li[data-id="${CSS.escape(id)}"]`);
  }

  // ---- dal collegamento col ponte ----

  stato(collegato: boolean, inCoda: number): void {
    document.body.classList.toggle('scollegato', !collegato);
    const coda =
      inCoda === 0
        ? ''
        : inCoda === 1
          ? tr({ it: ' · 1 tiro in coda', en: ' · 1 roll queued' })
          : tr({ it: ` · ${inCoda} tiri in coda`, en: ` · ${inCoda} rolls queued` });
    this.statoPonte.textContent = (collegato ? tr({ it: 'collegato', en: 'connected' }) : tr({ it: 'scollegato', en: 'disconnected' })) + coda;
    this.statoPonte.classList.toggle('scollegato', !collegato);
  }

  /** L'avviso del DM in alto: la richiesta più vecchia col suo TIRA, e quante altre aspettano. */
  richieste(r: readonly RichiestaCreata[]): void {
    this.richiesteMostrate = r;
    this.banner.replaceChildren();
    const prima = r[0];
    this.banner.hidden = !prima;
    if (!prima) return;
    const testo = crea('span', 'chiede');
    testo.append(tr({ it: 'Il DM chiede: ', en: 'The DM asks: ' }), crea('strong', undefined, prima.label), `, ${prima.formula}`);
    const tira = crea('button', 'tira-richiesta', tr({ it: 'TIRA', en: 'ROLL' }));
    tira.type = 'button';
    tira.title = tr({ it: `tira ${prima.formula} per il DM`, en: `roll ${prima.formula} for the DM` });
    tira.disabled = this.inCorso;
    tira.addEventListener('mousedown', (e) => e.preventDefault());
    tira.addEventListener('click', () => {
      this.mostraErrore(null);
      this.azioni.lanciaRichiesta(prima).catch(() => {
        // Il motivo arriva già all'avviso sul vassoio.
      });
    });
    this.banner.append(testo, tira);
    if (r.length > 1) {
      const altre =
        r.length === 2
          ? tr({ it: 'e un’altra in fila', en: 'and one more waiting' })
          : tr({ it: `e altre ${r.length - 1} in fila`, en: `and ${r.length - 1} more waiting` });
      this.banner.append(crea('span', 'in-fila', altre));
    }
  }

  get richiesteAperte(): readonly RichiestaCreata[] {
    return this.richiesteMostrate;
  }

  /** La cronaca dal registro dall'ultimo PULISCI in poi, più i tiri ancora in coda; sopravvive ai riavvii. */
  cronaca(registrati: readonly VoceDiCronaca[], inCoda: readonly TiroDalTavolo[]): void {
    const visti = new Set(registrati.map((t) => t.id));
    const dopo = registrati.filter((t) => Date.parse(t.at) > this.pulitaAlle);
    const voci = [...dopo.map((t) => this.voce(t, false)), ...inCoda.filter((t) => !visti.has(t.id)).map((t) => this.voce(t, true))];
    this.voci.replaceChildren(...voci.reverse().slice(0, 300));
  }

  /**
   * PULISCI: via il totale dalla targa, gli avvisi e le voci della cronaca già nel registro, e la pagina
   * ricorda l'ora. Restano i tiri ancora in coda, che il DM non ha ancora ricevuto.
   */
  private sgombra(): void {
    this.risultato.hidden = true;
    this.avviso.hidden = true;
    this.avviso.classList.remove('grave', 'del-master', 'per-chi-gioca');
    this.avviso.replaceChildren();
    for (const li of [...this.voci.querySelectorAll('li:not(.in-coda)')]) li.remove();
    this.pulitaAlle = Date.now();
    try {
      localStorage.setItem(CHIAVE_PULITA, String(this.pulitaAlle));
    } catch {
      // Senza localStorage la cronaca torna intera alla prossima apertura della pagina.
    }
  }

  registrato(t: TiroCompletato): void {
    const vecchia = this.voceDi(t.id);
    // La nota del ponte (una richiesta sparita) resta anche dopo la registrazione.
    if (vecchia) vecchia.replaceWith(this.voce(t, false, vecchia.querySelector('.nota-ponte')?.textContent ?? undefined));
    else this.aggiungiCronaca(t);
  }

  inRegistro(id: string): void {
    const li = this.voceDi(id);
    if (!li) return;
    li.classList.remove('in-coda');
    li.querySelector('.attesa')?.remove();
  }

  respinto(t: TiroDalTavolo, motivo: string): void {
    const li = this.voceDi(t.id);
    if (li) li.replaceWith(this.voce(t, false, tr({ it: `non registrato: ${motivo}`, en: `not recorded: ${motivo}` })));
    this.mostraErrore(new Error(tr({ it: `il ponte non ha registrato il tiro: ${motivo}`, en: `the bridge did not record the roll: ${motivo}` })));
  }

  diventatoLibero(t: TiroDalTavolo, requestId: string, problema: ProblemaRichiesta): void {
    const li = this.voceDi(t.id);
    const resta = tr({ it: 'resta un tiro libero', en: 'kept as a free roll' });
    if (li) li.replaceWith(this.voce(t, true, `${requestId}: ${tr(PROBLEMI[problema])}: ${resta}`));
  }
}
