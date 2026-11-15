// Prove di equità: migliaia di lanci con la fisica vera, da soli e a gruppi, e il chi quadro sulle facce.
// Scrive docs/equita.md. Gira su quattro thread al più e con la priorità più bassa, così la macchina
// resta usabile mentre conta:
//   npm run fairness -- [moltiplicatore]
// Il moltiplicatore scala il numero dei lanci (1 = quelli scritti sotto).

import { writeFileSync } from 'node:fs';
import { cpus, setPriority } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { type Forma, FORME, valoreD100 } from '../src/shared/dadi.ts';
import { fonteCrypto } from '../src/physics/casuale.ts';
import { FISICA } from '../src/physics/config.ts';
import { type SpecDado, Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

interface Esperimento {
  nome: string;
  descrizione: string;
  specs: SpecDado[];
  lanci: number;
}

/** Conteggi di un blocco di lanci: categoria → valore → volte. */
type Conteggi = Record<string, Record<number, number>>;
interface EsitoBlocco {
  nome: string;
  conteggi: Conteggi;
  lanci: number;
  falliti: number;
  ritiri: number;
  tempo: number;
}

const k = Number(process.argv[2] ?? 1);
const semplice = (forma: Forma): SpecDado => ({ forma, ruolo: 'semplice' });
const ESPERIMENTI: Esperimento[] = [
  ...FORME.map((f) => ({ nome: `1${f}`, descrizione: `un ${f} da solo`, specs: [semplice(f)], lanci: Math.round(20000 * k) })),
  ...FORME.map((f) => ({
    nome: `5${f}`,
    descrizione: `cinque ${f} insieme, contati tutti`,
    specs: Array.from({ length: 5 }, () => semplice(f)),
    lanci: Math.round(4000 * k),
  })),
  {
    nome: '1d100',
    descrizione: 'un d100 (decine e unità)',
    specs: [
      { forma: 'd10', ruolo: 'decine' },
      { forma: 'd10', ruolo: 'unita' },
    ],
    lanci: Math.round(20000 * k),
  },
  {
    nome: 'tavolo pieno',
    descrizione: '10d6+5d8+5d20+5d100, trenta dadi insieme',
    specs: [
      ...Array.from({ length: 10 }, () => semplice('d6')),
      ...Array.from({ length: 5 }, () => semplice('d8')),
      ...Array.from({ length: 5 }, () => semplice('d20')),
      ...Array.from({ length: 5 }, (): SpecDado[] => [
        { forma: 'd10', ruolo: 'decine' },
        { forma: 'd10', ruolo: 'unita' },
      ]).flat(),
    ],
    lanci: Math.round(800 * k),
  },
];

function categoria(s: SpecDado): string {
  return s.forma === 'd10' && s.ruolo !== 'semplice' ? `d10 ${s.ruolo === 'decine' ? 'decine' : 'unità'}` : s.forma;
}

async function lavoratore(): Promise<void> {
  const R = await caricaRapier();
  const v = new Vassoio(R);
  const fonte = fonteCrypto();
  parentPort!.on('message', (m: { nome: string; lanci: number } | null) => {
    if (m === null) {
      v.libera();
      process.exit(0);
    }
    const e = ESPERIMENTI.find((x) => x.nome === m.nome)!;
    const conteggi: Conteggi = {};
    const conta = (cat: string, valore: number) => {
      const c = (conteggi[cat] ??= {});
      c[valore] = (c[valore] ?? 0) + 1;
    };
    let falliti = 0;
    let ritiri = 0;
    let tempo = 0;
    for (let i = 0; i < m.lanci; i++) {
      const l = v.lancia(e.specs, fonte);
      l.finoAllaFine();
      ritiri += l.registroRitiri.length;
      tempo += l.tempo;
      if (l.stato !== 'fermo') {
        falliti++;
        continue;
      }
      const letture = l.letture!;
      for (const x of letture) conta(categoria(x.spec), x.valore);
      // Il d100 intero: decine e unità in coppia, nell'ordine in cui stanno nelle specs.
      for (let j = 0; j < letture.length; j++) {
        const a = letture[j]!;
        if (a.spec.ruolo === 'decine') {
          const b = letture[j + 1]!;
          conta('d100', valoreD100(a.valore, b.valore));
        }
      }
    }
    const esito: EsitoBlocco = { nome: m.nome, conteggi, lanci: m.lanci, falliti, ritiri, tempo };
    parentPort!.postMessage(esito);
  });
}

// La statistica.

function lnGamma(x: number): number {
  const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < 8; i++) a += g[i]! / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Q(a, x): la gamma incompleta superiore regolarizzata. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let somma = 1 / a;
    let termine = somma;
    for (let n = 1; n < 1000; n++) {
      termine *= x / (a + n);
      somma += termine;
      if (Math.abs(termine) < Math.abs(somma) * 1e-15) break;
    }
    return 1 - somma * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

function chiQuadro(osservati: number[]): { chi: number; gdl: number; p: number; scartoMassimo: number } {
  const n = osservati.reduce((s, x) => s + x, 0);
  const atteso = n / osservati.length;
  const chi = osservati.reduce((s, o) => s + ((o - atteso) * (o - atteso)) / atteso, 0);
  const gdl = osservati.length - 1;
  const scartoMassimo = Math.max(...osservati.map((o) => Math.abs(o - atteso) / atteso));
  return { chi, gdl, p: gammaQ(gdl / 2, chi / 2), scartoMassimo };
}

const VALORI: Record<string, number[]> = {
  d4: [1, 2, 3, 4],
  d6: [1, 2, 3, 4, 5, 6],
  d8: [1, 2, 3, 4, 5, 6, 7, 8],
  d10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  d12: Array.from({ length: 12 }, (_, i) => i + 1),
  d20: Array.from({ length: 20 }, (_, i) => i + 1),
  'd10 decine': [0, 10, 20, 30, 40, 50, 60, 70, 80, 90],
  'd10 unità': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  d100: Array.from({ length: 100 }, (_, i) => i + 1),
};

async function principale(): Promise<void> {
  const fili = Math.min(4, cpus().length);
  const BLOCCO = 500;
  const coda: { nome: string; lanci: number }[] = [];
  for (const e of ESPERIMENTI) {
    for (let fatti = 0; fatti < e.lanci; fatti += BLOCCO) coda.push({ nome: e.nome, lanci: Math.min(BLOCCO, e.lanci - fatti) });
  }
  const totaleBlocchi = coda.length;
  const somme = new Map<string, EsitoBlocco>();
  const inizio = Date.now();
  let fatti = 0;
  await Promise.all(
    Array.from({ length: fili }, async () => {
      const w = new Worker(new URL(import.meta.url), { workerData: { lavoratore: true } });
      const manda = () => {
        const m = coda.shift();
        w.postMessage(m ?? null);
        return m !== undefined;
      };
      await new Promise<void>((risolvi, rifiuta) => {
        w.on('message', (e: EsitoBlocco) => {
          const s = somme.get(e.nome) ?? { nome: e.nome, conteggi: {}, lanci: 0, falliti: 0, ritiri: 0, tempo: 0 };
          for (const [cat, valori] of Object.entries(e.conteggi)) {
            const c = (s.conteggi[cat] ??= {});
            for (const [v, n] of Object.entries(valori)) c[Number(v)] = (c[Number(v)] ?? 0) + n;
          }
          s.lanci += e.lanci;
          s.falliti += e.falliti;
          s.ritiri += e.ritiri;
          s.tempo += e.tempo;
          somme.set(e.nome, s);
          fatti++;
          if (fatti % 10 === 0 || fatti === totaleBlocchi) {
            process.stderr.write(`\r${fatti}/${totaleBlocchi} blocchi, ${Math.round((Date.now() - inizio) / 1000)} s   `);
          }
          if (!manda()) risolvi();
        });
        w.on('error', rifiuta);
        manda();
      });
    }),
  );
  process.stderr.write('\n');
  const secondi = Math.round((Date.now() - inizio) / 1000);
  scriviRapporto(somme, secondi, fili);
}

function scriviRapporto(somme: Map<string, EsitoBlocco>, secondi: number, fili: number): void {
  const righe: string[] = [];
  const data = new Date().toISOString().slice(0, 10);
  righe.push('# Equità dei dadi', '');
  righe.push(
    `Misurata il ${data} con \`strumenti/equita.ts\`: lanci simulati con la stessa fisica del tavolo (Rapier, \`src/physics\`), la stessa fonte del caso (\`crypto.getRandomValues\`) e la stessa lettura delle facce. ${fili} thread, ${secondi} secondi.`,
    '',
    `Parametri: gravità ${FISICA.gravita} cm/s², passo 1/${Math.round(1 / FISICA.passo)} s, vassoio ${FISICA.vassoio.larghezza}×${FISICA.vassoio.profondita} cm, tolleranza dello storto ${FISICA.tolleranzaStorto}°.`,
    '',
    'Come si legge: per ogni dado si contano le facce uscite e si confrontano con la distribuzione uniforme col chi quadro. Il valore p è la probabilità di vedere uno scarto almeno così grande con un dado perfettamente equo. Su una trentina di prove qualche p sotto 0,05 capita per caso (una su venti); un bias vero si riconosce perché resta sotto 0,001 anche rifacendo la prova con lanci nuovi. «Scarto massimo» è la faccia più lontana dall’atteso, in percentuale dell’atteso.',
    '',
    'Perché ci si aspetta l’equità prima ancora di contare: l’orientamento di partenza è uniforme su tutte le rotazioni, posizione, velocità e rotazione non dipendono da come il dado è girato, e il collisore del dado ha simmetrie che portano ogni faccia su ogni altra (il d12, composto da un cubo e sei tetti, ha le dodici rotazioni del tetraedro). Ogni simmetria scambia le facce lasciando identica la probabilità del lancio. Le prove controllano che il codice faccia davvero questo.',
    '',
    'Un bias trovato e tolto: nella prima misura, il 14 novembre 2026, il d12 è uscito con p sotto 0,001 in due prove separate, con le stesse facce sbilanciate (1 e 8 sopra l’atteso, 5 e 7 sotto, fino al 6%). La causa: Rapier costruisce il contatto di una faccia con al più quattro vertici, e sui pentagoni del d12 ne restava fuori uno, sempre lo stesso per faccia; il dado si ribaltava più facilmente da quel lato. Contro un fondo a scatola, poi, un punto in più ne faceva scartare uno anche su tre facce del d10. Adesso il d12 è un cubo con un tetto su ogni faccia (la costruzione di Euclide), fondo e sponde sono piani, e `test/fisica.test.ts` controlla che ogni faccia di ogni dado appoggi su tutti i suoi vertici. I numeri qui sotto sono quelli dopo la correzione.',
    '',
  );
  righe.push('## Sintesi', '', '| prova | categoria | dadi contati | χ² | gradi di libertà | p | scarto massimo | esito |', '|---|---|---:|---:|---:|---:|---:|---|');
  const dettagli: string[] = [];
  let peggiore = 1;
  for (const e of ESPERIMENTI) {
    const s = somme.get(e.nome);
    if (!s) continue;
    for (const [cat, valori] of Object.entries(s.conteggi).sort()) {
      const attesi = VALORI[cat];
      if (!attesi) continue;
      const osservati = attesi.map((v) => valori[v] ?? 0);
      const fuori = Object.keys(valori).filter((v) => !attesi.includes(Number(v)));
      if (fuori.length) throw new Error(`${e.nome} ${cat}: valori impossibili ${fuori.join(', ')}`);
      const n = osservati.reduce((a, b) => a + b, 0);
      const { chi, gdl, p, scartoMassimo } = chiQuadro(osservati);
      peggiore = Math.min(peggiore, p);
      const esito = p < 0.001 ? '**da rifare: possibile bias**' : p < 0.01 ? 'da tenere d’occhio' : 'nessun segno di bias';
      righe.push(`| ${e.nome} | ${cat} | ${n} | ${chi.toFixed(1)} | ${gdl} | ${p.toFixed(3)} | ${(scartoMassimo * 100).toFixed(1)}% | ${esito} |`);
      if (cat !== 'd100') {
        dettagli.push(`**${e.nome}, ${cat}** (${n} dadi, atteso ${(n / attesi.length).toFixed(0)} per faccia)`, '');
        dettagli.push(`| ${attesi.join(' | ')} |`, `|${attesi.map(() => '---:').join('|')}|`, `| ${osservati.join(' | ')} |`, '');
      } else {
        const dec = Array.from({ length: 10 }, (_, d) => osservati.slice(d * 10, d * 10 + 10));
        dettagli.push(`**${e.nome}, d100 intero** (${n} tiri, atteso ${(n / 100).toFixed(0)} per valore; righe da 1-10 a 91-100)`, '');
        dettagli.push('| da | +0 | +1 | +2 | +3 | +4 | +5 | +6 | +7 | +8 | +9 |', '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
        dec.forEach((r, d) => dettagli.push(`| ${d * 10 + 1} | ${r.join(' | ')} |`));
        dettagli.push('');
      }
    }
  }
  righe.push('', '## Lanci, ritiri, durata', '', '| prova | lanci | falliti | ritiri per lancio | durata media |', '|---|---:|---:|---:|---:|');
  for (const e of ESPERIMENTI) {
    const s = somme.get(e.nome);
    if (!s) continue;
    righe.push(`| ${e.nome} (${e.descrizione}) | ${s.lanci} | ${s.falliti} | ${(s.ritiri / s.lanci).toFixed(3)} | ${(s.tempo / s.lanci).toFixed(2)} s |`);
  }
  righe.push('', `Il p più basso fra tutte le prove: ${peggiore.toFixed(4)}.`, '', '## I conteggi', '', ...dettagli);
  writeFileSync(new URL('../docs/equita.md', import.meta.url), righe.join('\n') + '\n');
  console.log(righe.slice(0, righe.indexOf('## I conteggi')).join('\n'));
}

if (isMainThread) {
  // Prima dei thread, che la ereditano. Dove non si può abbassare, si conta lo stesso.
  try {
    setPriority(19);
  } catch {
    // priorità che resta com'è
  }
  await principale();
} else if ((workerData as { lavoratore?: boolean })?.lavoratore) {
  await lavoratore();
}
