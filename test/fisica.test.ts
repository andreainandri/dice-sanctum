import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { FORME, geometria } from '../src/shared/dadi.ts';
import { impostaLingua } from '../src/shared/lingua.ts';
import { leggi, orientamentoPerFaccia } from '../src/shared/lettura.ts';
import { leggiFormula } from '../src/shared/notazione.ts';
import { calcola } from '../src/shared/conto.ts';
import { prodotto, punto, quatDaA, quatDaAsseAngolo, ruota } from '../src/shared/vettori.ts';
import { fonteDaSeme } from '../src/physics/casuale.ts';
import { FISICA } from '../src/physics/config.ts';
import { Accumulatore } from '../src/physics/orologio.ts';
import { lettiDaLetture, specsDaFormula } from '../src/physics/tiro.ts';
import { type SpecDado, Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

const R = await caricaRapier();
const vassoi: Vassoio[] = [];
function nuovoVassoio(): Vassoio {
  const v = new Vassoio(R);
  vassoi.push(v);
  return v;
}
after(() => {
  for (const v of vassoi) v.libera();
});

describe('fisica', () => {
  it('appoggiato su ogni faccia, ogni dado tocca il fondo con tutti i vertici di quella faccia', () => {
    // Il d12 intero ne toccava quattro su cinque, e le facce non erano più equiprobabili.
    const v = nuovoVassoio();
    for (const forma of FORME) {
      const g = geometria(forma);
      for (let i = 0; i < g.facce.length; i++) {
        for (const giro of [0.1, 1.3, 2.9, 4.4]) {
          v.lancia([{ forma, ruolo: 'semplice' }], fonteDaSeme(17));
          const corpo = v.dadi[0]!.corpo;
          const q = prodotto(quatDaAsseAngolo([0, 1, 0], giro), quatDaA(g.normali[i]!, [0, -1, 0]));
          corpo.setTranslation({ x: 0, y: punto(g.centri[i]!, g.normali[i]!), z: 0 }, true);
          corpo.setRotation(q, true);
          corpo.setLinvel({ x: 0, y: 0, z: 0 }, true);
          corpo.setAngvel({ x: 0, y: 0, z: 0 }, true);
          v.world.step();
          const punti: { x: number; z: number }[] = [];
          for (let c = 0; c < corpo.numColliders(); c++) {
            v.world.contactPair(v.fondo, corpo.collider(c), (m) => {
              for (let k = 0; k < m.numSolverContacts(); k++) punti.push(m.solverContactPoint(k)!);
            });
          }
          const p = corpo.translation();
          const mancanti = g.facce[i]!.filter((vi) => {
            const w = ruota(q, g.vertici[vi]!);
            return !punti.some((c) => Math.hypot(c.x - (p.x + w[0]), c.z - (p.z + w[2])) < 0.02);
          });
          assert.equal(mancanti.length, 0, `${forma}, faccia ${i}: ${mancanti.length} vertici senza contatto`);
        }
      }
    }
  });

  it('ogni tipo di dado si ferma, piatto, dentro il vassoio, e la lettura è quella della faccia ferma', () => {
    const v = nuovoVassoio();
    const fonte = fonteDaSeme(11);
    const specs: SpecDado[] = [
      ...FORME.map((forma) => ({ forma, ruolo: 'semplice' as const })),
      { forma: 'd10', ruolo: 'decine' },
      { forma: 'd10', ruolo: 'unita' },
    ];
    for (const spec of specs) {
      for (let k = 0; k < 15; k++) {
        const l = v.lancia([spec], fonte);
        assert.equal(l.finoAllaFine(), 'fermo', `${spec.forma}: ${l.motivo}`);
        const [let0] = l.letture!;
        const d = v.dadi[0]!;
        assert.ok(v.dentro(d));
        assert.ok(let0!.inclinazione <= FISICA.tolleranzaStorto);
        assert.equal(let0!.lettura, leggi(geometria(spec.forma), v.orientamento(d)).lettura);
      }
    }
  });

  it('trenta dadi insieme si fermano tutti, ognuno letto', () => {
    const v = nuovoVassoio();
    const fonte = fonteDaSeme(12);
    const f = leggiFormula('10d6+5d8+5d20+5d100');
    assert.equal(f.dadiFisici, 30);
    for (let k = 0; k < 4; k++) {
      const l = v.lancia(specsDaFormula(f), fonte);
      assert.equal(l.finoAllaFine(), 'fermo', l.motivo ?? '');
      assert.equal(l.letture!.length, 30);
      const c = calcola(f, lettiDaLetture(f, l.letture!));
      assert.ok(c.total >= 10 + 5 + 5 + 5 && c.total <= 60 + 40 + 100 + 500);
    }
  });

  it('un dado uscito dal vassoio si ritira e il tiro si chiude', () => {
    const v = nuovoVassoio();
    const l = v.lancia([{ forma: 'd20', ruolo: 'semplice' }], fonteDaSeme(13));
    for (let i = 0; i < 30; i++) l.passo();
    v.dadi[0]!.corpo.setTranslation({ x: 200, y: 5, z: 0 }, true);
    assert.equal(l.finoAllaFine(), 'fermo');
    assert.deepEqual(l.registroRitiri, [{ indice: 0, motivo: 'uscito' }]);
    assert.equal(l.letture![0]!.ritiri, 1);
  });

  it('un dado storto si ritira sotto gli occhi di chi guarda', () => {
    const v = nuovoVassoio();
    let volte = 0;
    const avvisi: string[] = [];
    const l = v.lancia(
      [
        { forma: 'd6', ruolo: 'semplice' },
        { forma: 'd8', ruolo: 'semplice' },
      ],
      fonteDaSeme(14),
      {
        controlloStorto: (i, incl) => (i === 1 && volte++ === 0 ? true : incl > FISICA.tolleranzaStorto),
        alRitiro: (i, motivo, n) => avvisi.push(`${i}:${motivo}:${n}`),
      },
    );
    assert.equal(l.finoAllaFine(), 'fermo');
    assert.deepEqual(avvisi, ['1:storto:1']);
    assert.equal(l.letture![1]!.ritiri, 1);
    assert.equal(l.letture![0]!.ritiri, 0);
  });

  it('al ritiro di troppo dello stesso dado il tiro fallisce, con un messaggio chiaro', () => {
    const v = nuovoVassoio();
    const l = v.lancia([{ forma: 'd20', ruolo: 'semplice' }, { forma: 'd4', ruolo: 'semplice' }], fonteDaSeme(15), {
      controlloStorto: (i) => i === 0,
    });
    assert.equal(l.finoAllaFine(), 'fallito');
    assert.equal(l.motivo, 'the d20 came to rest tilted for the fourth time: roll cancelled, roll again');
    // La stessa scena con la pagina in italiano.
    impostaLingua('it');
    try {
      const it = nuovoVassoio().lancia([{ forma: 'd20', ruolo: 'semplice' }, { forma: 'd4', ruolo: 'semplice' }], fonteDaSeme(15), {
        controlloStorto: (i) => i === 0,
      });
      assert.equal(it.finoAllaFine(), 'fallito');
      assert.equal(it.motivo, 'il d20 si è fermato storto per la quarta volta: tiro annullato, rilancia');
    } finally {
      impostaLingua('en');
    }
    assert.equal(l.registroRitiri.filter((r) => r.indice === 0).length, FISICA.ritiriMassimi);
    assert.equal(l.letture, null);
  });

  it('un dado che non si ferma entro sei secondi si ritira', () => {
    const v = nuovoVassoio();
    const l = v.lancia([{ forma: 'd12', ruolo: 'semplice' }], fonteDaSeme(16));
    // Lo si tiene in moto a forza finché il tavolo non lo ritira.
    while (l.stato === 'in corso' && l.registroRitiri.length === 0) {
      v.dadi[0]!.corpo.setAngvel({ x: 0, y: 20, z: 0 }, true);
      l.passo();
    }
    assert.deepEqual(l.registroRitiri, [{ indice: 0, motivo: 'non si ferma' }]);
    assert.ok(l.tempo > FISICA.tempoMassimoDado && l.tempo < FISICA.tempoMassimoDado + 0.5, `tempo ${l.tempo}`);
    assert.equal(l.finoAllaFine(), 'fermo');
  });

  it('l’inclinazione misurata è l’angolo vero dalla verticale', () => {
    const g = geometria('d20');
    const base = orientamentoPerFaccia(g, 3);
    for (const gradi of [2, 5, 9, 15]) {
      const q = prodotto(quatDaAsseAngolo([1, 0, 0], (gradi * Math.PI) / 180), base);
      const l = leggi(g, q);
      assert.equal(l.faccia, 3);
      assert.ok(Math.abs(l.inclinazione - gradi) < 1e-6);
    }
  });

  it('lo stesso lancio fa gli stessi passi e la stessa lettura a 30 e a 144 fotogrammi al secondo', () => {
    const f = leggiFormula('3d6+2d20+1d100');
    const esito = (fps: number) => {
      const v = nuovoVassoio();
      const l = v.lancia(specsDaFormula(f), fonteDaSeme(99));
      const acc = new Accumulatore(FISICA.passo);
      let passi = 0;
      let fotogrammi = 0;
      while (l.stato === 'in corso' && fotogrammi < 100_000) {
        const n = acc.passi(1 / fps);
        for (let i = 0; i < n && l.stato === 'in corso'; i++) {
          l.passo();
          passi++;
        }
        fotogrammi++;
      }
      return { stato: l.stato, passi, valori: l.letture!.map((x) => x.valore), tempo: l.tempo };
    };
    const a = esito(30);
    const b = esito(144);
    assert.equal(a.stato, 'fermo');
    assert.deepEqual(a, b);
  });

  it('durata: un dado solo fra 1 e 2 secondi, trenta dadi fra 2 e 4,5', () => {
    const v = nuovoVassoio();
    const fonte = fonteDaSeme(18);
    const mediana = (testo: string, n: number) => {
      const f = leggiFormula(testo);
      const tempi: number[] = [];
      for (let k = 0; k < n; k++) {
        const l = v.lancia(specsDaFormula(f), fonte);
        l.finoAllaFine();
        tempi.push(l.tempo);
      }
      tempi.sort((a, b) => a - b);
      return tempi[Math.floor(n / 2)]!;
    };
    for (const testo of ['1d20', '1d6', '1d4', '1d12', '1d100', '2d20kh1', '4d6']) {
      const m = mediana(testo, 15);
      assert.ok(m >= 1 && m <= 2, `${testo}: mediana ${m.toFixed(2)} s`);
    }
    const m30 = mediana('10d6+5d8+5d20+5d100', 7);
    assert.ok(m30 >= 2 && m30 <= 4.5, `trenta dadi: mediana ${m30.toFixed(2)} s`);
  });
});
