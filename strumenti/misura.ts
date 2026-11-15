// Misura dei lanci con la fisica vera: durata, ritiri, rimbalzi sulle sponde.
// Serve a tarare i parametri di src/physics/config.ts guardando i numeri.
//
// Uso: node strumenti/misura.ts [lanci per formula] ['{"dado":{"smorzamentoAngolare":0.3}}']
// Il secondo argomento sostituisce pezzi della configurazione, per provare senza toccare il file.

import { geometria } from '../src/shared/dadi.ts';
import { leggi } from '../src/shared/lettura.ts';
import { leggiFormula } from '../src/shared/notazione.ts';
import { fonteCrypto } from '../src/physics/casuale.ts';
import { FISICA, type ConfigFisica } from '../src/physics/config.ts';
import { specsDaFormula } from '../src/physics/tiro.ts';
import { Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

function fondi<T>(base: T, sopra: unknown): T {
  if (typeof sopra !== 'object' || sopra === null) return sopra === undefined ? base : (sopra as T);
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(sopra)) out[k] = fondi((base as Record<string, unknown>)[k], v);
  return out as T;
}

const lanci = Number(process.argv[2] ?? 40);
const cfg: ConfigFisica = fondi(FISICA, process.argv[3] ? JSON.parse(process.argv[3]) : undefined);
const R = await caricaRapier();
const v = new Vassoio(R, cfg);
const fonte = fonteCrypto();

const FORMULE = (process.env.FORMULE ?? '1d20,2d20kh1,1d6,4d6,8d6,1d4,1d8,1d10,1d12,1d100,2d6+1d4,10d6+5d8+5d20+5d100').split(',');
const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))]!;
const storti: string[] = [];
console.log('formula               mediana   p10    p90    max   ritiri/tiro  falliti');
for (const testo of FORMULE) {
  const f = leggiFormula(testo);
  const tempi: number[] = [];
  let ritiri = 0;
  let falliti = 0;
  for (let k = 0; k < lanci; k++) {
    const l = v.lancia(specsDaFormula(f), fonte, {
      alRitiro: (i, motivo) => {
        const d = v.dadi[i]!;
        const t = d.corpo.translation();
        const W = cfg.vassoio.larghezza / 2;
        const D = cfg.vassoio.profondita / 2;
        const sponda = Math.min(W - Math.abs(t.x), D - Math.abs(t.z));
        const incl = leggi(geometria(d.spec.forma), d.corpo.rotation()).inclinazione;
        storti.push(`${testo} ${d.spec.forma} ${motivo}: inclinazione ${incl.toFixed(1)}°, altezza ${t.y.toFixed(2)}, dalla sponda ${sponda.toFixed(2)} cm`);
      },
    });
    l.finoAllaFine();
    if (l.stato === 'fallito') falliti++;
    ritiri += l.registroRitiri.length;
    tempi.push(l.tempo);
  }
  tempi.sort((a, b) => a - b);
  console.log(
    `${testo.padEnd(21)} ${q(tempi, 0.5).toFixed(2).padStart(6)} ${q(tempi, 0.1).toFixed(2).padStart(6)} ${q(tempi, 0.9).toFixed(2).padStart(6)} ${tempi.at(-1)!.toFixed(2).padStart(6)} ${(ritiri / lanci).toFixed(3).padStart(10)} ${String(falliti).padStart(8)}`,
  );
}
if (process.env.DETTAGLI) for (const s of storti.slice(0, Number(process.env.DETTAGLI))) console.log('  ' + s);
v.libera();
