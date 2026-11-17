// La ripresa di un lancio: le pose di ogni dado, fotogramma per fotogramma, dalla partenza alla quiete.
// Chi la riceve rivede lo stesso lancio senza rifare la fisica, e i dadi si fermano sulle stesse facce
// che il lancio ha letto. Serve ai tiri del master: li tira il ponte, e il tavolo ne mostra la ripresa.

import { daBase64, inBase64 } from '../shared/base64.ts';
import { type Quat, type V3 } from '../shared/vettori.ts';
import { type Fonte } from './casuale.ts';
import { type LetturaFinale, type OpzioniLancio, type SpecDado, type Vassoio } from './vassoio.ts';

/** Per ogni dado e ogni fotogramma: x y z, poi il quaternione x y z w. */
export const NUMERI_PER_POSA = 7;
/** Un fotogramma ogni tanti passi della fisica: col passo da 1/120 sono sessanta al secondo. */
const PASSI_PER_FOTOGRAMMA = 2;

export interface Ripresa {
  dadi: SpecDado[];
  /** Secondi fra un fotogramma e il seguente. */
  passo: number;
  fotogrammi: number;
  /** Le pose in Float32 (ordine dei byte della macchina, little-endian ovunque giri il tavolo), in base64. */
  pose: string;
  /**
   * [fotogramma, dado]: fra il fotogramma prima e questo il dado è stato ritirato, o lasciato cadere nella
   * torre alla sua ondata: sta altrove, e fra i due non si interpola.
   */
  salti: [number, number][];
}

export type EsitoRipresa =
  | { stato: 'fermo'; letture: LetturaFinale[]; ripresa: Ripresa; durata: number }
  | { stato: 'fallito'; motivo: string };

/** Lancia i dadi nel vassoio e corre fino alla quiete, riprendendo le pose. `opzioni` serve alle prove. */
export function riprendi(
  vassoio: Vassoio,
  specs: readonly SpecDado[],
  fonte: Fonte,
  opzioni: Pick<OpzioniLancio, 'controlloStorto'> = {},
): EsitoRipresa {
  const numeri: number[] = [];
  const salti: [number, number][] = [];
  const ritirati = new Set<number>();
  // Anche il dado che cade nella torre alla sua ondata salta di posto, da dove aspettava alla bocca.
  const lancio = vassoio.lancia(specs, fonte, { ...opzioni, alRitiro: (i) => ritirati.add(i), alRilascio: (i) => ritirati.add(i) });
  let fotogrammi = 0;
  const scatta = () => {
    for (const d of vassoio.dadi) {
      const { p, q } = vassoio.posa(d);
      numeri.push(p[0], p[1], p[2], q.x, q.y, q.z, q.w);
    }
    for (const i of ritirati) salti.push([fotogrammi, i]);
    ritirati.clear();
    fotogrammi++;
  };
  scatta();
  let passi = 0;
  while (lancio.stato === 'in corso') {
    lancio.passo();
    passi++;
    // L'ultimo passo si riprende sempre: la ripresa finisce sulla posa che il lancio ha letto.
    if (passi % PASSI_PER_FOTOGRAMMA === 0 || lancio.stato !== 'in corso') scatta();
  }
  if (lancio.stato !== 'fermo' || !lancio.letture) return { stato: 'fallito', motivo: lancio.motivo ?? 'the throw failed' };
  const passo = vassoio.cfg.passo * PASSI_PER_FOTOGRAMMA;
  const pose = new Float32Array(numeri);
  return {
    stato: 'fermo',
    letture: lancio.letture,
    ripresa: {
      dadi: specs.map((s) => ({ forma: s.forma, ruolo: s.ruolo })),
      passo,
      fotogrammi,
      pose: inBase64(new Uint8Array(pose.buffer)),
      salti,
    },
    durata: (fotogrammi - 1) * passo,
  };
}

/** Una ripresa pronta da mostrare: le pose decodificate e i salti per fotogramma. */
export class RipresaLetta {
  readonly ripresa: Ripresa;
  readonly durata: number;
  private readonly pose: Float32Array;
  private readonly salti = new Map<number, Set<number>>();

  /** Lancia se le pose non hanno la misura che fotogrammi e dadi dicono. */
  constructor(ripresa: Ripresa) {
    this.ripresa = ripresa;
    const n = ripresa.dadi.length;
    if (!Number.isInteger(ripresa.fotogrammi) || ripresa.fotogrammi < 1 || n < 1 || !(ripresa.passo > 0)) {
      throw new Error('ripresa senza fotogrammi o senza dadi');
    }
    const bytes = daBase64(ripresa.pose);
    if (bytes.length !== ripresa.fotogrammi * n * NUMERI_PER_POSA * 4) throw new Error('le pose non hanno la misura della ripresa');
    this.pose = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    for (const [f, d] of ripresa.salti) {
      const s = this.salti.get(f) ?? new Set<number>();
      s.add(d);
      this.salti.set(f, s);
    }
    this.durata = (ripresa.fotogrammi - 1) * ripresa.passo;
  }

  /** La posa del dado a un fotogramma. */
  posa(fotogramma: number, dado: number): { p: V3; q: Quat } {
    const k = (fotogramma * this.ripresa.dadi.length + dado) * NUMERI_PER_POSA;
    const a = this.pose;
    return { p: [a[k]!, a[k + 1]!, a[k + 2]!], q: { x: a[k + 3]!, y: a[k + 4]!, z: a[k + 5]!, w: a[k + 6]! } };
  }

  /** Vero se il dado arriva a questo fotogramma da un ritiro. */
  salta(fotogramma: number, dado: number): boolean {
    return this.salti.get(fotogramma)?.has(dado) ?? false;
  }
}
