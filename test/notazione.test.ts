import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type DadoLetto, calcola, riassunto, tenuti, valoreAmmesso } from '../src/shared/conto.ts';
import { ErroreFormula, aggiungiDado, conVantaggio, contaPerLati, gruppi, leggiFormula, type Formula } from '../src/shared/notazione.ts';
import { fonteDaSeme, intero } from '../src/physics/casuale.ts';
import { impostaLingua, linguaDa } from '../src/shared/lingua.ts';

// I messaggi qui sotto sono quelli della pagina in italiano; quelli inglesi hanno la loro prova.
impostaLingua('it');

const ESEMPI: [string, string, number][] = [
  // testo, forma canonica, dadi fisici
  ['d20', '1d20', 1],
  ['1d20+5', '1d20+5', 1],
  ['2d20kh1+5', '2d20kh1+5', 2],
  ['2d20kl1', '2d20kl1', 2],
  ['4d6kh3', '4d6kh3', 4],
  ['4d6dl1', '4d6dl1', 4],
  ['3d8+5', '3d8+5', 3],
  ['2d6+1d4+3', '2d6+1d4+3', 3],
  ['1d20-2', '1d20-2', 1],
  ['1d20+5-1d4', '1d20+5-1d4', 2],
  ['8d6', '8d6', 8],
  ['1d100', '1d100', 2],
  ['d%', '1d100', 2],
  [' 2D20 KH1 + 5 ', '2d20kh1+5', 2],
  ['D12', '1d12', 1],
  ['-1d4+10', '-1d4+10', 1],
  ['15d100', '15d100', 30],
  ['30d6', '30d6', 30],
  ['2d10', '2d10', 2],
];

function errore(testo: string): string {
  try {
    leggiFormula(testo);
  } catch (e) {
    assert.ok(e instanceof ErroreFormula, `${testo}: errore di tipo sbagliato`);
    return e.message;
  }
  assert.fail(`${testo}: doveva essere respinta`);
}

/** Minimo e massimo del totale, calcolati dalla formula. */
function estremi(f: Formula): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const t of f.termini) {
    if (t.tipo === 'costante') {
      lo += t.segno * t.valore;
      hi += t.segno * t.valore;
      continue;
    }
    const k = !t.tieni ? t.numero : t.tieni.mode === 'kh' || t.tieni.mode === 'kl' ? t.tieni.n : t.numero - t.tieni.n;
    const a = 1;
    const b = t.lati;
    if (t.segno === 1) {
      lo += k * a;
      hi += k * b;
    } else {
      lo -= k * b;
      hi -= k * a;
    }
  }
  return [lo, hi];
}

function dadiCasuali(f: Formula, seme: number): DadoLetto[][] {
  const fonte = fonteDaSeme(seme);
  return gruppi(f).map((g) =>
    Array.from({ length: g.numero }, () => {
      if (g.lati === 100) {
        const tens = intero(fonte, 10) * 10;
        const units = intero(fonte, 10);
        return { value: tens === 0 && units === 0 ? 100 : tens + units, tens, units, rethrows: 0 };
      }
      return { value: 1 + intero(fonte, g.lati), rethrows: 0 };
    }),
  );
}

describe('notazione', () => {
  for (const [testo, canonica, fisici] of ESEMPI) {
    it(`«${testo}» → ${canonica}, ${fisici} dadi sul tavolo`, () => {
      const f = leggiFormula(testo);
      assert.equal(f.testo, canonica);
      assert.equal(f.dadiFisici, fisici);
      // La forma canonica si rilegge uguale.
      assert.equal(leggiFormula(f.testo).testo, canonica);
    });
  }

  it('gli errori dicono dove e perché', () => {
    assert.equal(errore('d7'), 'd7: non esiste un dado da 7');
    assert.equal(errore('2d7+1'), 'd7: non esiste un dado da 7');
    assert.equal(errore(''), 'formula vuota');
    assert.equal(errore('   '), 'formula vuota');
    assert.match(errore('2d20kh3'), /non si tengono 3 dadi su 2/);
    assert.match(errore('2d20kh0'), /tenere 0 dadi/);
    assert.match(errore('4d6dl4'), /non ne resta nessuno/);
    assert.match(errore('4d6dl0'), /scartare 0 dadi/);
    assert.match(errore('1d20+'), /manca un dado o un numero dopo «\+»/);
    assert.match(errore('1d20-'), /manca un dado o un numero dopo «-»/);
    assert.match(errore('1d20++5'), /due segni di fila/);
    assert.match(errore('1d20x'), /«x» \(posizione 5\): carattere non previsto/);
    assert.match(errore('abc'), /«a» \(posizione 1\)/);
    assert.match(errore('2d'), /manca il numero di facce dopo la d/);
    assert.match(errore('0d6'), /serve almeno un dado/);
    assert.match(errore('31d6'), /troppi dadi/);
    assert.match(errore('16d100'), /32 dadi sul tavolo, al massimo 30 \(il d100 ne conta due\)/);
    assert.match(errore('20d6+11d4'), /31 dadi sul tavolo/);
    assert.match(errore('5'), /manca un dado, ci sono solo numeri/);
    assert.match(errore('5+3'), /manca un dado/);
    assert.match(errore('1d20kh'), /manca il numero dopo kh/);
    assert.match(errore('4d6k3'), /scrivi kh per tenere i più alti o kl per i più bassi/);
    assert.match(errore('kh1'), /kh va dopo un gruppo di dadi/);
    assert.match(errore('4d6kh3kl1'), /un solo kh, kl, dh o dl per gruppo/);
    assert.match(errore('1d20 5'), /qui serve \+ o -/);
    assert.match(errore('2 3'), /qui serve \+ o -/);
    assert.match(errore('1d20+99999'), /numero troppo grande/);
    assert.match(errore('5kh1'), /manca la d del dado/);
    assert.match(errore('%'), /il % va dopo la d/);
    assert.match(errore('1d20+' + '1'.repeat(250)), /formula troppo lunga/);
  });

  it('in inglese, gli stessi errori nella lingua della pagina', () => {
    impostaLingua('en');
    try {
      assert.equal(errore('d7'), 'd7: there is no 7-sided die');
      assert.equal(errore(''), 'empty formula');
      assert.match(errore('1d20x'), /“x” \(position 5\): unexpected character/);
      assert.match(errore('1d20+'), /a die or a number is missing after “\+”/);
      assert.match(errore('16d100'), /32 dice on the table, at most 30 \(a d100 counts as two\)/);
      assert.match(errore('5'), /no dice, only numbers/);
      assert.match(errore('1d20+' + '1'.repeat(250)), /formula too long \(at most 200 characters\)/);
      assert.throws(() => conVantaggio('2d6', 'vantaggio'), /advantage needs a d20 roll, and there is none here/);
    } finally {
      impostaLingua('it');
    }
  });

  it('la lingua della pagina viene dalle preferenze del browser', () => {
    assert.equal(linguaDa(['it-IT', 'en-US']), 'it');
    assert.equal(linguaDa(['en-GB', 'it']), 'en');
    assert.equal(linguaDa(['de-DE', 'it-CH']), 'it');
    assert.equal(linguaDa(['fr-FR', 'de']), 'en');
    assert.equal(linguaDa([]), 'en');
    assert.equal(linguaDa([' IT_it ']), 'it');
  });

  it('vantaggio e svantaggio cambiano il d20 e tengono i modificatori', () => {
    assert.equal(conVantaggio('1d20+5', 'vantaggio').testo, '2d20kh1+5');
    assert.equal(conVantaggio('d20+5', 'svantaggio').testo, '2d20kl1+5');
    assert.equal(conVantaggio('', 'vantaggio').testo, '2d20kh1');
    assert.equal(conVantaggio(' ', 'svantaggio').testo, '2d20kl1');
    assert.equal(conVantaggio('2d20kh1+5', 'svantaggio').testo, '2d20kl1+5');
    assert.equal(conVantaggio('1d20+5-1d4', 'vantaggio').testo, '2d20kh1+5-1d4');
    assert.equal(conVantaggio('1d4+1d20+2', 'vantaggio').testo, '1d4+2d20kh1+2');
    assert.throws(() => conVantaggio('2d6', 'vantaggio'), /il vantaggio vale per un tiro di d20/);
    assert.throws(() => conVantaggio('1d20+1d20', 'vantaggio'), /più gruppi di d20/);
    assert.throws(() => conVantaggio('3d20', 'svantaggio'), /lo svantaggio vale per un d20 solo/);
  });

  it('il pannello dei dadi aggiunge e toglie dadi nella formula', () => {
    const casi: [string, 4 | 6 | 8 | 10 | 12 | 20 | 100, 1 | -1, string][] = [
      ['', 20, 1, '1d20'],
      ['1d20', 20, 1, '2d20'],
      ['d20 + 5', 6, 1, '1d20+1d6+5'],
      ['2d20kh1+5', 20, 1, '2d20kh1+1d20+5'],
      ['1d20+1d6+5', 6, -1, '1d20+5'],
      ['1d6+5', 6, -1, '5'],
      ['5', 8, 1, '1d8+5'],
      ['1d4', 4, -1, ''],
      ['d%', 100, 1, '2d100'],
      ['1d20-1d4', 4, 1, '1d20-1d4+1d4'],
    ];
    for (const [testo, lati, delta, atteso] of casi) assert.equal(aggiungiDado(testo, lati, delta), atteso, `${testo} ${delta > 0 ? '+' : '-'}d${lati}`);
    // Togliere un dado che non c'è lascia il testo com'è, anche non canonico.
    assert.equal(aggiungiDado(' 1D20 ', 4, -1), ' 1D20 ');
    assert.equal(aggiungiDado('2d20kh1', 20, -1), '2d20kh1');
  });

  it('il pannello rispetta i limiti e gli errori della formula', () => {
    assert.throws(() => aggiungiDado('30d6', 6, 1), (e: unknown) => e instanceof ErroreFormula && e.message === '31d6: troppi dadi (al massimo 30 sul tavolo)');
    assert.throws(() => aggiungiDado('15d100', 4, 1), (e: unknown) => e instanceof ErroreFormula && /31 dadi sul tavolo, al massimo 30/.test(e.message));
    assert.throws(() => aggiungiDado('2d7', 6, 1), (e: unknown) => e instanceof ErroreFormula && e.message === 'd7: non esiste un dado da 7');
  });

  it('il pannello conta i dadi di ogni tipo', () => {
    const c = contaPerLati('2d20kh1+1d6-1d6+3+d%');
    assert.deepEqual([...c.entries()], [[20, 2], [6, 2], [100, 1]]);
    assert.equal(contaPerLati('').size, 0);
    assert.equal(contaPerLati('7').size, 0);
  });
});

describe('conto', () => {
  it('tenuti e scartati, a parità vince il primo tirato', () => {
    assert.deepEqual(tenuti([3, 6, 1, 6], { mode: 'kh', n: 1 }), [false, true, false, false]);
    assert.deepEqual(tenuti([3, 6, 1, 6], { mode: 'kh', n: 3 }), [true, true, false, true]);
    assert.deepEqual(tenuti([3, 6, 1, 1], { mode: 'kl', n: 1 }), [false, false, true, false]);
    assert.deepEqual(tenuti([3, 6, 1, 5], { mode: 'dl', n: 1 }), [true, true, false, true]);
    assert.deepEqual(tenuti([3, 6, 1, 5], { mode: 'dh', n: 2 }), [true, false, true, false]);
    assert.deepEqual(tenuti([2, 2], null), [true, true]);
  });

  it('la riga del PROMPT: Attacco 2d20kh1+5', () => {
    const f = leggiFormula('2d20kh1+5');
    const c = calcola(f, [
      [
        { value: 17, rethrows: 0 },
        { value: 9, rethrows: 1 },
      ],
    ]);
    assert.equal(c.total, 22);
    assert.equal(c.constant, 5);
    assert.equal(riassunto(f, c, 'Attacco'), 'Attacco 2d20kh1+5: [17 (9)] +5 = 22');
    assert.deepEqual(c.groups[0]!.dice, [
      { value: 17, kept: true, rethrows: 0 },
      { value: 9, kept: false, rethrows: 1 },
    ]);
    assert.equal(c.nat20, false);
    assert.equal(c.nat1, false);
  });

  it('modificatori negativi, più gruppi, senza etichetta', () => {
    const f = leggiFormula('1d20+5-1d4');
    const c = calcola(f, [[{ value: 12, rethrows: 0 }], [{ value: 3, rethrows: 0 }]]);
    assert.equal(c.total, 14);
    assert.equal(riassunto(f, c, ''), '1d20+5-1d4: [12] - [3] +5 = 14');
    const g = leggiFormula('1d20-2');
    assert.equal(riassunto(g, calcola(g, [[{ value: 1, rethrows: 0 }]]), ' Prova '), 'Prova 1d20-2: [1] -2 = -1');
    const h = leggiFormula('-1d4+10');
    assert.equal(riassunto(h, calcola(h, [[{ value: 4, rethrows: 0 }]]), ''), '-1d4+10: -[4] +10 = 6');
  });

  it('i naturali solo con un d20 tenuto, letto sul dado tenuto', () => {
    const nat = (testo: string, valori: number[][]) => {
      const f = leggiFormula(testo);
      const c = calcola(
        f,
        valori.map((g) => g.map((value) => ({ value, rethrows: 0 }))),
      );
      return [c.nat20, c.nat1];
    };
    assert.deepEqual(nat('1d20+5', [[20]]), [true, false]);
    assert.deepEqual(nat('1d20+5', [[1]]), [false, true]);
    assert.deepEqual(nat('2d20kh1', [[20, 3]]), [true, false]);
    assert.deepEqual(nat('2d20kh1', [[1, 3]]), [false, false]); // il tenuto è il 3
    assert.deepEqual(nat('2d20kh1', [[1, 1]]), [false, true]);
    assert.deepEqual(nat('2d20kl1', [[20, 3]]), [false, false]);
    assert.deepEqual(nat('2d20kl1', [[20, 20]]), [true, false]);
    assert.deepEqual(nat('2d20kl1', [[1, 20]]), [false, true]);
    assert.deepEqual(nat('2d20', [[20, 20]]), [false, false]); // due d20 tenuti
    assert.deepEqual(nat('1d20+1d4', [[20], [2]]), [true, false]);
    assert.deepEqual(nat('1d4-1d20', [[2], [20]]), [false, false]);
    assert.deepEqual(nat('3d6', [[6, 6, 6]]), [false, false]);
  });

  it('d100: le parti nel registro, 00 e 0 fanno 100', () => {
    const f = leggiFormula('1d100');
    const c = calcola(f, [[{ value: 73, tens: 70, units: 3, rethrows: 0 }]]);
    assert.deepEqual(c.groups[0]!.dice[0], { value: 73, tens: 70, units: 3, kept: true, rethrows: 0 });
    assert.equal(JSON.stringify(c.groups[0]!.dice[0]), '{"value":73,"tens":70,"units":3,"kept":true,"rethrows":0}');
    assert.ok(valoreAmmesso(100, { value: 100, tens: 0, units: 0, rethrows: 0 }));
    assert.ok(!valoreAmmesso(100, { value: 0, tens: 0, units: 0, rethrows: 0 }));
    assert.ok(!valoreAmmesso(100, { value: 73, tens: 70, units: 4, rethrows: 0 }));
    assert.ok(!valoreAmmesso(100, { value: 75, tens: 75, units: 0, rethrows: 0 }));
    assert.ok(!valoreAmmesso(20, { value: 21, rethrows: 0 }));
    assert.ok(!valoreAmmesso(6, { value: 0, rethrows: 0 }));
    assert.ok(!valoreAmmesso(6, { value: 2.5, rethrows: 0 }));
  });

  it('il conto rifiuta dadi in numero sbagliato', () => {
    const f = leggiFormula('2d6+1d4');
    assert.throws(() => calcola(f, [[{ value: 1, rethrows: 0 }]]), /servono 2 gruppi/);
    assert.throws(() => calcola(f, [[{ value: 1, rethrows: 0 }], [{ value: 1, rethrows: 0 }]]), /2d6: servono 2 dadi, arrivati 1/);
  });

  it('i totali restano sempre dentro l’intervallo della formula', () => {
    for (const [testo] of ESEMPI) {
      const f = leggiFormula(testo);
      const [lo, hi] = estremi(f);
      for (let s = 0; s < 300; s++) {
        const c = calcola(f, dadiCasuali(f, s * 31 + testo.length));
        assert.ok(c.total >= lo && c.total <= hi, `${testo}: ${c.total} fuori da [${lo}, ${hi}]`);
        for (const g of c.groups) {
          const k = g.dice.filter((d) => d.kept).length;
          const atteso = !g.keep ? g.count : g.keep.mode === 'kh' || g.keep.mode === 'kl' ? g.keep.n : g.count - g.keep.n;
          assert.equal(k, atteso);
        }
      }
    }
  });
});
