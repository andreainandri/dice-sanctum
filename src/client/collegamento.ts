// Il collegamento col ponte: WebSocket verso la stessa origine della pagina. I tiri aspettano in coda
// (anche in localStorage, per una pagina chiusa o ricaricata) finché il ponte non li ha nel registro;
// a ogni riconnessione la coda riparte, e il ponte scarta i doppioni per id.

import { type Ripresa } from '../physics/ripresa.ts';
import {
  type RichiestaCreata,
  type TiroCompletato,
  type TiroCoperto,
  type TiroDalTavolo,
  type TiroDelMaster,
  type VoceDiCronaca,
} from '../shared/eventi.ts';
import { type DalPonte, type DalTavolo, type ProblemaRichiesta } from '../shared/protocollo.ts';
import { SERIE_DEL_MASTER_DI_PARTENZA, type Serie, eSerie } from '../shared/serie.ts';

const CHIAVE_CODA = 'dice-sanctum.coda';
const RIPROVA_MS = [500, 1000, 2000, 3000, 5000];

export interface Osservatore {
  /** La serie dei dadi del master, all'arrivo e ogni volta che la cambia. */
  dadiDelMaster(serie: Serie): void;
  /** Collegato o no, e quanti tiri aspettano di arrivare al registro. */
  stato(collegato: boolean, inCoda: number): void;
  /** Le richieste del DM ancora da tirare, la più vecchia per prima. */
  richieste(r: readonly RichiestaCreata[]): void;
  /** La cronaca dal registro, dal più vecchio al più nuovo, più i tiri ancora in coda. */
  cronaca(registrati: readonly VoceDiCronaca[], inCoda: readonly TiroDalTavolo[]): void;
  /** Un tiro appena entrato nel registro, da questo tavolo o da un altro. */
  registrato(t: TiroCompletato): void;
  /** Il tiro con questo id è nel registro (anche se c'era già). */
  inRegistro(id: string): void;
  /** Un tiro che il ponte non registra, col perché. */
  respinto(t: TiroDalTavolo, motivo: string): void;
  /** Un lancio in chiaro del master, già nel registro, con la ripresa da mostrare (o senza, se non c'è). */
  lancioDelMaster(tiri: readonly TiroDelMaster[], ripresa: Ripresa | null): void;
  /** Un lancio che il master ha fatto al posto di chi gioca, già nel registro, con la ripresa da mostrare. */
  lancioPerChiGioca(tiri: readonly TiroCompletato[], ripresa: Ripresa): void;
  /** Il master ha tirato dietro lo schermo. */
  dietroLoSchermo(t: TiroCoperto): void;
  /** Un tiro chiesto dal DM che resta come tiro libero: la richiesta `requestId` non c'era più, per `problema`. */
  diventatoLibero(t: TiroDalTavolo, requestId: string, problema: ProblemaRichiesta): void;
}

function leggiCoda(): TiroDalTavolo[] {
  try {
    const dato: unknown = JSON.parse(localStorage.getItem(CHIAVE_CODA) ?? '[]');
    if (!Array.isArray(dato)) return [];
    return dato.filter((t): t is TiroDalTavolo => typeof t === 'object' && t !== null && typeof (t as { id?: unknown }).id === 'string');
  } catch {
    return [];
  }
}

export class Collegamento {
  private readonly osserva: Osservatore;
  private readonly indirizzo: string;
  private ws: WebSocket | null = null;
  private collegato = false;
  private tentativi = 0;
  private coda: TiroDalTavolo[] = leggiCoda();
  /** Le richieste aperte nel registro; quelle con un tiro in coda non si mostrano più. */
  private aperte: RichiestaCreata[] = [];

  constructor(osserva: Osservatore, indirizzo = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) {
    this.osserva = osserva;
    this.indirizzo = indirizzo;
    this.osserva.stato(false, this.coda.length);
    // Una pagina ricaricata da scollegati mostra subito i tiri rimasti in coda.
    if (this.coda.length) this.osserva.cronaca([], this.coda);
    this.apri();
  }

  get inCoda(): readonly TiroDalTavolo[] {
    return this.coda;
  }

  get eCollegato(): boolean {
    return this.collegato;
  }

  /** Un tiro appena fermo: in coda subito, al ponte appena c'è. */
  invia(t: TiroDalTavolo): void {
    this.coda.push(t);
    this.salvaCoda();
    this.manda(t);
    this.aggiornaRichieste();
    this.osserva.stato(this.collegato, this.coda.length);
  }

  private salvaCoda(): void {
    try {
      localStorage.setItem(CHIAVE_CODA, JSON.stringify(this.coda));
    } catch {
      // Senza localStorage la coda resta in memoria: si perde solo chiudendo la pagina da scollegati.
    }
  }

  private manda(t: TiroDalTavolo): void {
    if (!this.collegato || !this.ws) return;
    const m: DalTavolo = { tipo: 'tiro', evento: t };
    this.ws.send(JSON.stringify(m));
  }

  private apri(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.indirizzo);
    } catch {
      this.riprova();
      return;
    }
    this.ws = ws;
    ws.addEventListener('message', (m) => {
      if (typeof m.data !== 'string') return;
      let dato: DalPonte;
      try {
        dato = JSON.parse(m.data) as DalPonte;
      } catch {
        return;
      }
      this.messaggio(dato);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.collegato = false;
      this.osserva.stato(false, this.coda.length);
      this.riprova();
    });
  }

  private riprova(): void {
    const attesa = RIPROVA_MS[Math.min(this.tentativi, RIPROVA_MS.length - 1)]!;
    this.tentativi++;
    setTimeout(() => this.apri(), attesa);
  }

  private messaggio(m: DalPonte): void {
    switch (m.tipo) {
      case 'stato': {
        // Il ponte parla per primo: da qui il tavolo è collegato e la coda riparte, in ordine.
        this.collegato = true;
        this.tentativi = 0;
        this.aperte = [...m.richieste];
        // Un ponte di prima della scelta non la manda: il master ha i dadi di partenza.
        this.osserva.dadiDelMaster(eSerie(m.dadiDelMaster) ? m.dadiDelMaster : SERIE_DEL_MASTER_DI_PARTENZA);
        this.osserva.cronaca(m.cronaca, this.coda);
        for (const t of this.coda) this.manda(t);
        this.aggiornaRichieste();
        this.osserva.stato(true, this.coda.length);
        break;
      }
      case 'evento': {
        const e = m.evento;
        if (e.type === 'request.created') {
          if (!this.aperte.some((r) => r.requestId === e.requestId)) this.aperte.push(e);
        } else if (e.type === 'request.cancelled') {
          this.aperte = this.aperte.filter((r) => r.requestId !== e.requestId);
        } else if (e.type === 'dm.roll.hidden') {
          this.osserva.dietroLoSchermo(e);
        } else if (e.type === 'dm.roll.completed') {
          this.osserva.lancioDelMaster([e], null);
        } else {
          if (e.requestId) this.aperte = this.aperte.filter((r) => r.requestId !== e.requestId);
          this.osserva.registrato(e);
        }
        this.aggiornaRichieste();
        break;
      }
      case 'lancio del master': {
        if (Array.isArray(m.tiri) && m.tiri.length > 0) this.osserva.lancioDelMaster(m.tiri, m.ripresa);
        break;
      }
      case 'dadi del master': {
        if (eSerie(m.serie)) this.osserva.dadiDelMaster(m.serie);
        break;
      }
      case 'lancio per chi gioca': {
        if (Array.isArray(m.tiri) && m.tiri.length > 0) this.osserva.lancioPerChiGioca(m.tiri, m.ripresa);
        break;
      }
      case 'ricevuto': {
        // Per un doppione non segue nessun evento: la voce in cronaca si segna da qui.
        this.togli(m.id);
        this.osserva.inRegistro(m.id);
        break;
      }
      case 'respinto': {
        const t = m.id === null ? undefined : this.coda.find((x) => x.id === m.id);
        if (!t) break;
        if (m.richiesta && t.requestId) {
          // Il tiro è buono, la richiesta no (annullata o già soddisfatta): resta un tiro libero.
          const libero: TiroDalTavolo = { ...t, requestId: null };
          this.coda = this.coda.map((x) => (x.id === t.id ? libero : x));
          this.salvaCoda();
          this.osserva.diventatoLibero(libero, t.requestId, m.richiesta);
          this.manda(libero);
        } else {
          // Un tiro che il ponte non accetta non passerà mai: esce dalla coda e l'interfaccia lo dice.
          this.togli(t.id);
          this.osserva.respinto(t, m.motivo);
        }
        this.aggiornaRichieste();
        break;
      }
    }
  }

  private togli(id: string): void {
    const prima = this.coda.length;
    this.coda = this.coda.filter((t) => t.id !== id);
    if (this.coda.length === prima) return;
    this.salvaCoda();
    this.osserva.stato(this.collegato, this.coda.length);
  }

  private aggiornaRichieste(): void {
    const tirate = new Set(this.coda.map((t) => t.requestId).filter((r): r is string => r !== null));
    this.osserva.richieste(this.aperte.filter((r) => !tirate.has(r.requestId)));
  }
}
