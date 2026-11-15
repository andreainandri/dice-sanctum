// Passo fisso con accumulatore: i fotogrammi dicono quanto tempo è passato, la fisica
// avanza a passi uguali. Un lancio fa gli stessi passi a 30 come a 144 fotogrammi al secondo.

export class Accumulatore {
  private resto = 0;
  private readonly passo: number;
  private readonly massimoPassi: number;

  constructor(passo: number, massimoPassi = 30) {
    this.passo = passo;
    this.massimoPassi = massimoPassi;
  }

  /** Quanti passi fissi servono per un fotogramma lungo dt secondi. */
  passi(dt: number): number {
    // Una scheda rimasta in sottofondo non deve recuperare minuti di fisica in un colpo.
    this.resto += Math.min(Math.max(dt, 0), 0.25);
    let n = Math.floor(this.resto / this.passo + 1e-9);
    if (n > this.massimoPassi) {
      n = this.massimoPassi;
      this.resto = 0;
    } else {
      this.resto = Math.max(0, this.resto - n * this.passo);
    }
    return n;
  }

  /** Frazione di passo avanzata, per interpolare il disegno fra due stati. */
  get alfa(): number {
    return this.resto / this.passo;
  }

  azzera(): void {
    this.resto = 0;
  }
}
