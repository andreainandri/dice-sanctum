import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { geometria } from '../src/shared/dadi.ts';
import { impostaLingua } from '../src/shared/lingua.ts';
import { fonteDaSeme } from '../src/physics/casuale.ts';
import { type ConfigFisica, FISICA } from '../src/physics/config.ts';
import { riprendi } from '../src/physics/ripresa.ts';
import { celleDellaBocca, misureTorre } from '../src/physics/torre.ts';
import { type SpecDado, Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

const R = await caricaRapier();
const vassoi: Vassoio[] = [];
function nuovoVassoio(cfg: ConfigFisica = FISICA): Vassoio {
  const v = new Vassoio(R, cfg);
  vassoi.push(v);
  return v;
}
after(() => {
  for (const v of vassoi) v.libera();
});

const d6 = (quanti: number): SpecDado[] => Array.from({ length: quanti }, () => ({ forma: 'd6', ruolo: 'semplice' }));
/** La distanza fra due vertici opposti del dado più grande. */
const DADO_PIU_GRANDE = 2 * Math.max(...(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const).map((f) => Math.max(...geometria(f).vertici.map((p) => Math.hypot(p[0], p[1], p[2])))));

describe('la torre dei dadi', () => {
  it('le misure: il dado più grande passa oltre ogni labbro, sotto ogni scivolo e sotto l’arco', () => {
    const t = misureTorre(FISICA);
    assert.equal(t.scivoli.length, FISICA.torre.scivoli.length);
    const quotaRampa = (z: number) => FISICA.torre.rampa * (1 - (z - t.z0) / (t.z2 - t.z0));
    // Dal più basso: sotto il labbro c'è la rampa, poi il labbro dello scivolo di sotto.
    let sotto = (z: number) => quotaRampa(z);
    for (const s of [...t.scivoli].reverse()) {
      const [muro, labbro, labbroSotto] = [s[0]!, s[1]!, s[2]!];
      const diFronte = muro[0] === t.z0 ? t.z1 : t.z0;
      assert.ok(Math.abs(diFronte - labbro[0]) > DADO_PIU_GRANDE + 1, 'fra il labbro e la parete di fronte');
      assert.ok(labbroSotto[1] - sotto(labbro[0]) > DADO_PIU_GRANDE + 1, 'sotto il labbro');
      assert.ok(muro[1] > labbro[1], 'lo scivolo scende verso il labbro');
      const cima = labbro[1];
      sotto = () => cima;
    }
    assert.ok(t.arco - quotaRampa(t.z1) > DADO_PIU_GRANDE + 1, 'sotto l’arco');
    assert.ok(t.alta > t.scivoli[0]![0]![1], 'l’orlo sta sopra lo scivolo più alto');
    assert.ok(t.alta + FISICA.lancio.sopraLOrlo + 2 < FISICA.vassoio.coperchio, 'i dadi cadono da sotto il coperchio');
  });

  it('la bocca: celle dentro la canna, staccate dalle pareti e fra loro', () => {
    const t = misureTorre(FISICA);
    const { passoGriglia, gioco } = FISICA.lancio;
    const celle = celleDellaBocca(t, passoGriglia, gioco);
    assert.ok(celle.length >= FISICA.lancio.onda, `celle ${celle.length}`);
    for (const [x, z] of celle) {
      assert.ok(x - t.x0 >= gioco - 1e-9 && t.x1 - x >= gioco - 1e-9);
      assert.ok(z - t.z0 >= gioco - 1e-9 && t.z1 - z >= gioco - 1e-9);
    }
    for (let i = 0; i < celle.length; i++) {
      for (let j = i + 1; j < celle.length; j++) {
        assert.ok(Math.hypot(celle[i]![0] - celle[j]![0], celle[i]![1] - celle[j]![1]) >= passoGriglia - 1e-9);
      }
    }
    // Due dadi vicini non nascono compenetrati, anche con lo scarto.
    assert.ok(passoGriglia - 2 * FISICA.lancio.scarto >= DADO_PIU_GRANDE - 1e-9);
  });

  it('a ondate: chi non sta nella prima aspetta fuori dal mondo e cade al suo turno', () => {
    const v = nuovoVassoio();
    const onda = FISICA.lancio.onda;
    const rilasciati: { indice: number; tempo: number }[] = [];
    const l = v.lancia(d6(onda + 3), fonteDaSeme(5), { alRilascio: (indice) => rilasciati.push({ indice, tempo: l.tempo }) });
    const inAttesa = v.dadi.filter((d) => d.partenza !== null);
    assert.equal(inAttesa.length, 3);
    for (const d of inAttesa) {
      assert.equal(d.corpo.isEnabled(), false);
      assert.ok(d.corpo.translation().y > FISICA.vassoio.coperchio, 'in attesa sta sopra il coperchio');
    }
    for (const d of v.dadi.filter((x) => x.partenza === null)) {
      const p = d.corpo.translation();
      assert.ok(d.corpo.isEnabled());
      assert.ok(p.z > v.torre.z0 && p.z < v.torre.z1 && p.y > v.torre.alta, 'la prima ondata parte sopra la bocca');
    }
    const passi = Math.round(FISICA.lancio.intervallo / FISICA.passo);
    for (let k = 0; k < passi - 1; k++) l.passo();
    assert.equal(rilasciati.length, 0);
    assert.equal(l.stato, 'in corso');
    l.passo();
    l.passo();
    assert.deepEqual(rilasciati.map((r) => r.indice).sort(), inAttesa.map((d) => d.indice).sort());
    assert.ok(v.dadi.every((d) => d.partenza === null && d.corpo.isEnabled()));
    assert.equal(l.finoAllaFine(), 'fermo');
    assert.equal(l.letture!.length, onda + 3);
  });

  it('i dadi si leggono soltanto nella corte', () => {
    const v = nuovoVassoio();
    for (let seme = 1; seme <= 12; seme++) {
      const l = v.lancia(d6(8), fonteDaSeme(seme));
      assert.equal(l.finoAllaFine(), 'fermo');
      for (const d of v.dadi) assert.ok(d.corpo.translation().z >= v.torre.z2, `seme ${seme}: un dado letto dentro la torre`);
    }
  });

  it('un dado fermo nella torre si ritira, e al ritiro di troppo il tiro fallisce col suo motivo', () => {
    impostaLingua('it');
    // Senza pendenza e senza scivoli: il dado cade sul fondo della torre e ci resta.
    const v = nuovoVassoio({ ...FISICA, torre: { ...FISICA.torre, rampa: 0, scivoli: [] } } as unknown as ConfigFisica);
    const l = v.lancia([{ forma: 'd6', ruolo: 'semplice' }], fonteDaSeme(3));
    // La spinta di lato non basta a uscire: lo si ferma appena tocca il fondo.
    const ferma = () => {
      const d = v.dadi[0]!;
      if (d.partenza === null && d.corpo.translation().y < 3) {
        const p = d.corpo.translation();
        d.corpo.setTranslation({ x: 0, y: p.y, z: (v.torre.z0 + v.torre.z1) / 2 }, true);
        d.corpo.setLinvel({ x: 0, y: d.corpo.linvel().y, z: 0 }, true);
      }
    };
    while (l.stato === 'in corso') {
      ferma();
      l.passo();
    }
    assert.equal(l.stato, 'fallito');
    assert.equal(l.registroRitiri.length, FISICA.ritiriMassimi);
    assert.ok(l.registroRitiri.every((r) => r.motivo === 'nella torre'));
    assert.match(l.motivo!, /il d6 è rimasto nella torre/);
  });

  it('nella ripresa il dado che cade alla sua ondata lascia un salto', () => {
    const v = nuovoVassoio();
    const onda = FISICA.lancio.onda;
    const esito = riprendi(v, d6(onda + 2), fonteDaSeme(11));
    assert.equal(esito.stato, 'fermo');
    if (esito.stato !== 'fermo') return;
    const dalRilascio = esito.ripresa.salti.filter(([f]) => f * esito.ripresa.passo <= FISICA.lancio.intervallo + 2 * esito.ripresa.passo);
    assert.equal(dalRilascio.length, 2);
    for (const [f] of dalRilascio) assert.ok(f > 0);
  });
});
