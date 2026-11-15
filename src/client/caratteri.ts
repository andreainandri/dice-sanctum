// I caratteri della pagina: Noto Serif dalla cartella `caratteri` (licenza OFL in caratteri/OFL.txt),
// dichiarati in stile.css. Si caricano prima di dipingere le facce dei dadi, che li usano sulla tela:
// un numero dipinto col carattere di ripiego resterebbe tale fino alla riapertura.

/** Aspetta i tre pesi, al più tre secondi: senza, il tavolo parte col serif di ripiego. */
export async function caricaCaratteri(): Promise<void> {
  const pesi = ['400', '600', '700'].map((peso) => document.fonts.load(`${peso} 32px "Sanctum Serif"`));
  const tempo = new Promise<void>((ok) => setTimeout(ok, 3000));
  try {
    await Promise.race([Promise.all(pesi), tempo]);
  } catch {
    // Un carattere che non si carica lascia il ripiego: il tavolo funziona lo stesso.
  }
}
