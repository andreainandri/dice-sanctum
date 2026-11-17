// Misura dei lanci con la fisica vera: durata, uscita dalla torre, ritiri coi motivi, pareti attraversate.
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
import { type MotivoRitiro, Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

function fondi<T>(base: T, sopra: unknown): T {
  // Le liste si sostituiscono intere.
  if (typeof sopra !== 'object' || sopra === null || Array.isArray(sopra)) return sopra === undefined ? base : (sopra as T);
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
const dettagli: string[] = [];
const MOTIVI: MotivoRitiro[] = ['nella torre', 'storto', 'uscito', 'non si ferma'];
const torre = v.torre;
console.log('formula               mediana   p10    p90    max   uscita   torre  storto  uscito  mai fermo  falliti  attraversa  sotto');
for (const testo of FORMULE) {
  const f = leggiFormula(testo);
  const specs = specsDaFormula(f);
  const tempi: number[] = [];
  const uscite: number[] = [];
  const ritiri = new Map<MotivoRitiro, number>();
  let falliti = 0;
  let attraversati = 0;
  /** Di quanto il dado più affondato è sceso sotto il fondo, in media sui tiri. */
  let sotto = 0;
  for (let k = 0; k < lanci; k++) {
    const l = v.lancia(specs, fonte, {
      alRitiro: (i, motivo) => {
        ritiri.set(motivo, (ritiri.get(motivo) ?? 0) + 1);
        const d = v.dadi[i]!;
        const t = d.corpo.translation();
        const incl = leggi(geometria(d.spec.forma), v.orientamento(d)).inclinazione;
        dettagli.push(`${testo} ${d.spec.forma} ${motivo}: a (${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}), inclinazione ${incl.toFixed(1)}°`);
      },
    });
    const raggi = v.dadi.map((d) => Math.max(...geometria(d.spec.forma).vertici.map((p) => Math.hypot(p[0], p[1], p[2]))));
    const inCanna = v.dadi.map(() => false);
    let uscita = 0;
    let fondo = 0;
    while (l.stato === 'in corso') {
      l.passo();
      let dentro = false;
      v.dadi.forEach((d, i) => {
        if (d.partenza) {
          dentro = true;
          inCanna[i] = false;
          return;
        }
        const t = d.corpo.translation();
        if (v.nellaTorre(d)) dentro = true;
        // Dalla canna a fuori dalla torre sopra l'arco, in un passo: il dado ha attraversato una parete.
        const oraInCanna = t.z < torre.z1;
        if (inCanna[i] && t.z > torre.z2 && t.y > torre.arco + raggi[i]!) attraversati++;
        inCanna[i] = oraInCanna;
        // Quanto il centro scende sotto la quota a cui il dado sta appoggiato su una faccia (stima per difetto).
        if (!v.nellaTorre(d)) fondo = Math.max(fondo, -Math.min(0, t.y - raggi[i]! * 0.3));
      });
      if (dentro) uscita = l.tempo;
    }
    if (l.stato === 'fallito') {
      falliti++;
      dettagli.push(`${testo} FALLITO: ${l.motivo}`);
    }
    sotto += fondo / lanci;
    tempi.push(l.tempo);
    uscite.push(uscita);
  }
  tempi.sort((a, b) => a - b);
  uscite.sort((a, b) => a - b);
  const n = (x: number, larga: number, cifre = 2) => x.toFixed(cifre).padStart(larga);
  console.log(
    `${testo.padEnd(21)} ${n(q(tempi, 0.5), 6)} ${n(q(tempi, 0.1), 6)} ${n(q(tempi, 0.9), 6)} ${n(tempi.at(-1)!, 6)} ${n(q(uscite, 0.5), 7)} ` +
      MOTIVI.map((m) => n((ritiri.get(m) ?? 0) / lanci, 7, 3)).join(' ') +
      `   ${String(falliti).padStart(7)} ${String(attraversati).padStart(10)} ${n(sotto, 7, 3)}`,
  );
}
if (process.env.DETTAGLI) for (const s of dettagli.slice(0, Number(process.env.DETTAGLI))) console.log('  ' + s);
v.libera();
