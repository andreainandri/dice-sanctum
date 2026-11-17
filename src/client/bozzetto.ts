// Il tavolo fermo, per gli scatti: una scena ripetibile per giudicare l'aspetto senza tirare a mano.
// Niente ponte: il tiro sul vassoio e quelli della cronaca escono dalla fisica vera, con semi fissi.
// Nell'indirizzo: formula=..., etichetta=..., seme=N (il primo da provare), naturale=20|1 (il tiro deve averlo),
// richiesta=0 (senza avviso del DM), lampo=MS (col 20 naturale, la scena è pronta MS millisecondi dopo l'inizio del lampo),
// sponda=vicina (un dado fermo contro la sponda dalla parte della camera, quella che può nasconderlo), toni=0 (nessun dado
// acceso o attenuato: il 20 naturale come gli altri), vetrina=1 (i dadi in fila davanti alla camera, ognuno col valore più
// alto rivolto a chi guarda e dritto: per giudicare una serie da vicino; il d20 mostra il suo 20).
// Per la torre: scivoli=N (quanti scivoli, al posto di quelli della configurazione), tempo=S (i dadi come stanno S secondi
// dopo il lancio, al posto di quelli fermi). Per i dadi: serie=NOME (quella di chi gioca, una di shared/serie.ts), dadimaster=NOME (quella del master; di serie sangue),
// master=1 (i dadi del tiro sono del master).

import * as THREE from 'three';
import { fonteDaSeme } from '../physics/casuale.ts';
import { type ConfigFisica, FISICA as DI_SERIE } from '../physics/config.ts';
import { lettiDaLetture, specsDaFormula } from '../physics/tiro.ts';
import { Vassoio, caricaRapier } from '../physics/vassoio.ts';
import { misureCorte } from '../physics/torre.ts';
import { type Conto, calcola } from '../shared/conto.ts';
import { geometria } from '../shared/dadi.ts';
import { type RichiestaCreata, type TiroCompletato, numera, tiroDalTavolo } from '../shared/eventi.ts';
import { tr } from '../shared/lingua.ts';
import { type Formula, leggiFormula } from '../shared/notazione.ts';
import { caricaCaratteri } from './caratteri.ts';
import { SERIE, SERIE_DEL_MASTER_DI_PARTENZA, SERIE_DI_PARTENZA } from '../shared/serie.ts';
import { type Tono, altoDellaFaccia } from './facce.ts';
import { Interfaccia, preparaLingua } from './interfaccia.ts';
import { caricaTrame } from './materiali.ts';
import { INCLINAZIONE, Scena } from './scena.ts';

declare global {
  interface Window {
    __bozzetto?: { seme: number; totale: number };
  }
}

const q = new URLSearchParams(location.search);
const scivoli = q.get('scivoli');
const FISICA: ConfigFisica =
  scivoli === null
    ? DI_SERIE
    : {
        ...DI_SERIE,
        torre: {
          ...DI_SERIE.torre,
          scivoli: Array.from({ length: Number(scivoli) }, (_, i) => ({ da: i % 2 === 0 ? ('corte' as const) : ('fondo' as const), sporge: 4.4, scende: 2.4 })),
        },
      };
preparaLingua();
const [R, , trame] = await Promise.all([caricaRapier(), caricaCaratteri(), caricaTrame()]);
const vassoio = new Vassoio(R, FISICA);

type Posa = ReturnType<Vassoio['posa']>;

/** Il primo seme, da `primo` in su, che dà un lancio fermo, senza ritiri, con il conto e le pose voluti. */
function lancioFermo(formula: Formula, primo: number, vale: (c: Conto, pose: Posa[]) => boolean) {
  for (let seme = primo; seme < primo + 4000; seme++) {
    let ritirato = false;
    const specs = specsDaFormula(formula);
    const l = vassoio.lancia(specs, fonteDaSeme(seme), {
      alRitiro: () => {
        ritirato = true;
      },
    });
    for (let k = 0; k < 20000 && l.stato === 'in corso'; k++) l.passo();
    if (l.stato !== 'fermo' || ritirato) continue;
    const conto = calcola(formula, lettiDaLetture(formula, l.letture!));
    const pose = vassoio.dadi.map((d) => vassoio.posa(d));
    if (!vale(conto, pose)) continue;
    return { seme, specs, conto, pose };
  }
  throw new Error(`nessun seme dà il tiro voluto per ${formula.testo}`);
}

const serieDelMaster = SERIE.find((s) => s === q.get('dadimaster')) ?? SERIE_DEL_MASTER_DI_PARTENZA;
const serie = SERIE.find((s) => s === q.get('serie') && s !== serieDelMaster) ?? SERIE_DI_PARTENZA;
const ui = new Interfaccia({ lancia: () => Promise.resolve(), lanciaRichiesta: () => Promise.resolve(), pulisci: () => {}, scegliSerie: (s) => scena.scegliSerie(s) }, serie, serieDelMaster);
ui.stato(true, 0);

// La cronaca di una sera di gioco, dal più vecchio al più nuovo.
const CAMPIONI = [
  { formula: '1d20+2', label: tr({ it: 'Iniziativa', en: 'Initiative' }), dm: false },
  { formula: '1d20+5', label: tr({ it: 'Attacco con lo spadone', en: 'Greatsword attack' }), dm: false },
  { formula: '2d6+3', label: tr({ it: 'Danni dello spadone', en: 'Greatsword damage' }), dm: false },
  { formula: '1d20+3', label: tr({ it: 'Salvezza su Costituzione', en: 'Constitution saving throw' }), dm: true },
  { formula: '2d20kh1+5', label: tr({ it: 'Attacco con vantaggio', en: 'Attack with advantage' }), dm: false },
];
const adesso = Date.now();
const registrati: TiroCompletato[] = CAMPIONI.map((c, i) => {
  const f = leggiFormula(c.formula);
  const { conto } = lancioFermo(f, 100 + i * 37, () => true);
  const at = new Date(adesso - (CAMPIONI.length - i) * 140_000).toISOString();
  return numera(tiroDalTavolo({ id: crypto.randomUUID(), at, label: c.label, formula: f, requestId: c.dm ? `r-000${i}` : null, conto }), 20 + i);
});
ui.cronaca(registrati, []);

if (q.get('richiesta') !== '0') {
  const r: RichiestaCreata = { v: 1, seq: 40, type: 'request.created', requestId: 'r-0009', at: new Date(adesso).toISOString(), formula: '1d20+1', label: tr({ it: 'Salvezza su Saggezza', en: 'Wisdom saving throw' }) };
  ui.richieste([r]);
}

const scena = new Scena(document.getElementById('tela')!, FISICA, trame, serie, serieDelMaster);
document.getElementById('caricamento')?.remove();

const formula = leggiFormula(q.get('formula') ?? '1d100+1d20+1d12+1d10+1d8+1d6+1d4');
const naturale = q.get('naturale');
const etichetta = q.get('etichetta') ?? tr({ it: 'Tutti i dadi', en: 'All the dice' });
// La sponda vicina sta a z = profondità / 2; un dado col centro entro un centimetro la tocca.
const controSponda = (pose: Posa[]) => pose.some((p) => p.p[2] > FISICA.vassoio.profondita / 2 - 1);
const tiro = lancioFermo(
  formula,
  Number(q.get('seme') ?? 1),
  (c, pose) => (naturale === '20' ? c.nat20 : naturale === '1' ? c.nat1 : true) && (q.get('sponda') !== 'vicina' || controSponda(pose)),
);
scena.impostaDadi(tiro.specs, q.get('master') === '1' ? 'master' : 'giocatore');
const tempo = q.get('tempo');
if (q.get('vetrina') === '1') {
  // In fila davanti alla camera: la faccia più alta guarda la camera, col numero dritto, e il dado scende
  // finché il suo vertice più basso tocca il velluto.
  const corte = misureCorte(FISICA);
  const verso = new THREE.Vector3(0, Math.cos(INCLINAZIONE), Math.sin(INCLINAZIONE));
  const su = new THREE.Vector3(0, 1, 0).addScaledVector(verso, -verso.y).normalize();
  const n = tiro.specs.length;
  tiro.specs.forEach((spec, i) => {
    const g = geometria(spec.forma);
    const faccia = g.letture.indexOf(Math.max(...g.letture));
    const normale = new THREE.Vector3(...g.centri[faccia]!).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(normale, verso);
    const alto = new THREE.Vector3(...altoDellaFaccia(spec.forma, faccia)).applyQuaternion(q1);
    const angolo = Math.atan2(new THREE.Vector3().crossVectors(alto, su).dot(verso), alto.dot(su));
    const qq = new THREE.Quaternion().setFromAxisAngle(verso, angolo).multiply(q1);
    const basso = Math.min(...g.vertici.map((v) => new THREE.Vector3(...v).applyQuaternion(qq).y));
    const x = corte.x0 + ((corte.x1 - corte.x0) * (i + 0.5)) / n;
    scena.posa(i, [x, -basso, corte.z1 - 5], { x: qq.x, y: qq.y, z: qq.z, w: qq.w });
  });
} else if (tempo === null) tiro.pose.forEach((p, i) => scena.posa(i, p.p, p.q));
else {
  // Lo stesso lancio, fermato a metà strada.
  const l = vassoio.lancia(tiro.specs, fonteDaSeme(tiro.seme));
  while (l.stato === 'in corso' && l.tempo < Number(tempo)) l.passo();
  vassoio.dadi.forEach((d, i) => {
    const p = vassoio.posa(d);
    scena.posa(i, p.p, p.q);
  });
}

// I toni come li dà il tavolo: scartati attenuati, il d20 naturale in oro o in rosso.
let indice = 0;
let dadoOro: number | null = null;
for (const g of tiro.conto.groups) {
  for (const d of g.dice) {
    let tono: Tono = d.kept || q.get('toni') === '0' ? 'normale' : 'scartato';
    if (d.kept && g.sides === 20 && g.sign === 1 && q.get('toni') !== '0') {
      if (tiro.conto.nat20 && d.value === 20) tono = 'oro';
      if (tiro.conto.nat1 && d.value === 1) tono = 'rosso';
    }
    const fisici = g.sides === 100 ? 2 : 1;
    for (let k = 0; k < fisici; k++) scena.tono(indice + k, tono);
    if (tono === 'oro') dadoOro = indice;
    indice += fisici;
  }
}
const evento = tiroDalTavolo({ id: crypto.randomUUID(), at: new Date(adesso).toISOString(), label: etichetta, formula, requestId: null, conto: tiro.conto });
ui.fine(evento);
scena.disegna();
const lampo = q.get('lampo');
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    scena.disegna();
    const pronto = () => (window.__bozzetto = { seme: tiro.seme, totale: tiro.conto.total });
    if (lampo !== null && dadoOro !== null) {
      scena.lampo(dadoOro);
      setTimeout(pronto, Number(lampo));
    } else pronto();
  }),
);
