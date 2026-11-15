// La lingua dei testi per chi usa il tavolo: italiano o inglese. Nel browser la pagina la sceglie
// all'avvio, dalla lingua del browser; nei processi di Node (ponte, server MCP, prove) resta l'inglese,
// che è anche la lingua dei testi per Claude.

export type Lingua = 'it' | 'en';

let corrente: Lingua = 'en';

export function impostaLingua(l: Lingua): void {
  corrente = l;
}

export function lingua(): Lingua {
  return corrente;
}

/** Il testo nella lingua corrente: ogni testo porta con sé le sue due versioni. */
export function tr(testi: Readonly<Record<Lingua, string>>): string {
  return testi[corrente];
}

/**
 * La lingua da un elenco di preferenze come `navigator.languages`: la prima fra italiano e inglese
 * che compare; senza nessuna delle due, l'inglese.
 */
export function linguaDa(preferenze: readonly string[]): Lingua {
  for (const p of preferenze) {
    const base = p.trim().toLowerCase().split(/[-_]/)[0];
    if (base === 'it' || base === 'en') return base;
  }
  return 'en';
}
