import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FORME,
  NUMERO_FACCE,
  type Forma,
  etichetta,
  geometria,
  vaSottolineata,
  valoreD100,
  valoreDaLettura,
} from '../src/shared/dadi.ts';
import { leggi, orientamentoPerFaccia } from '../src/shared/lettura.ts';
import { fonteDaSeme, quatUniforme } from '../src/physics/casuale.ts';
import { diff, lunghezza, prodotto, punto, quatDaAsseAngolo, ruota } from '../src/shared/vettori.ts';

const ATTESI: Record<Forma, number[]> = {
  d4: [1, 2, 3, 4],
  d6: [1, 2, 3, 4, 5, 6],
  d8: [1, 2, 3, 4, 5, 6, 7, 8],
  d10: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  d12: Array.from({ length: 12 }, (_, i) => i + 1),
  d20: Array.from({ length: 20 }, (_, i) => i + 1),
};

const LATI_FACCIA: Record<Forma, number> = { d4: 3, d6: 4, d8: 3, d10: 4, d12: 5, d20: 3 };

describe('geometrie', () => {
  for (const forma of FORME) {
    const g = geometria(forma);

    it(`${forma}: facce, lati per faccia, facce piane e normali uscenti`, () => {
      assert.equal(g.facce.length, NUMERO_FACCE[forma]);
      g.facce.forEach((f, i) => {
        assert.equal(f.length, LATI_FACCIA[forma], `faccia ${i}`);
        const n = g.normali[i]!;
        assert.ok(Math.abs(lunghezza(n) - 1) < 1e-12);
        const d = punto(n, g.vertici[f[0]!]!);
        assert.ok(d > 0, 'normale uscente');
        for (const vi of f) assert.ok(Math.abs(punto(n, g.vertici[vi]!) - d) < 1e-9, `faccia ${i} non piana`);
        for (const v of g.vertici) assert.ok(punto(n, v) <= d + 1e-9, `faccia ${i}: vertice oltre il piano`);
        // Antiorario visto da fuori: il prodotto dei primi due spigoli guarda come la normale.
        const a = g.vertici[f[0]!]!;
        const b = g.vertici[f[1]!]!;
        const c = g.vertici[f[2]!]!;
        const e1 = diff(b, a);
        const e2 = diff(c, b);
        const cr: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        assert.ok(punto(cr, n) > 0, `faccia ${i} non antioraria`);
      });
    });

    it(`${forma}: ogni valore una volta sola`, () => {
      assert.deepEqual([...g.letture].sort((a, b) => a - b), ATTESI[forma]);
    });

    if (forma !== 'd4') {
      it(`${forma}: facce opposte a somma ${g.sommaOpposte}`, () => {
        g.normali.forEach((n, i) => {
          const j = g.normali.findIndex((m) => punto(m, n) < -1 + 1e-9);
          assert.ok(j >= 0, `faccia ${i} senza opposta`);
          assert.equal(g.letture[i]! + g.letture[j]!, g.sommaOpposte);
        });
      });
    }

    it(`${forma}: la direzione del numero sta nel piano della faccia`, () => {
      g.alto.forEach((a, i) => {
        assert.ok(Math.abs(lunghezza(a) - 1) < 1e-9);
        assert.ok(Math.abs(punto(a, g.normali[i]!)) < 1e-9);
      });
    });

    it(`${forma}: il lettore restituisce il valore della faccia portata in lettura, a ogni rotazione attorno alla verticale`, () => {
      for (let i = 0; i < g.facce.length; i++) {
        const base = orientamentoPerFaccia(g, i);
        for (let k = 0; k < 12; k++) {
          const giro = quatDaAsseAngolo([0, 1, 0], (k * Math.PI) / 6 + 0.1);
          const q = prodotto(giro, base);
          const l = leggi(g, q);
          assert.equal(l.faccia, i);
          assert.equal(l.lettura, g.letture[i]);
          assert.ok(l.inclinazione < 1e-5, `inclinazione ${l.inclinazione}`);
        }
      }
    });

    it(`${forma}: la faccia vincente è sempre la più vicina alla verticale (orientamenti casuali)`, () => {
      const fonte = fonteDaSeme(7 + forma.length);
      for (let k = 0; k < 2000; k++) {
        const q = quatUniforme(fonte);
        const l = leggi(g, q);
        const verso = g.letturaInBasso ? -1 : 1;
        const migliore = Math.max(...g.normali.map((n) => ruota(q, n)[1] * verso));
        assert.ok(Math.abs(ruota(q, g.normali[l.faccia]!)[1] * verso - migliore) < 1e-12);
      }
    });
  }

  it('d4: il numero letto è quello del vertice in cima', () => {
    const g = geometria('d4');
    for (let i = 0; i < 4; i++) {
      const q = orientamentoPerFaccia(g, i);
      const alto = g.vertici.map((v, idx) => ({ idx, y: ruota(q, v)[1] })).sort((a, b) => b.y - a.y)[0]!;
      assert.equal(leggi(g, q).lettura, g.valoriVertici![alto.idx]);
      // La faccia in basso è quella che non contiene il vertice in cima.
      assert.ok(!g.facce[i]!.includes(alto.idx));
    }
  });

  it('d10: lo 0 vale 10; le decine vanno da 00 a 90', () => {
    assert.equal(valoreDaLettura('d10', 'semplice', 0), 10);
    assert.equal(valoreDaLettura('d10', 'semplice', 7), 7);
    assert.equal(valoreDaLettura('d10', 'decine', 0), 0);
    assert.equal(valoreDaLettura('d10', 'decine', 9), 90);
    assert.equal(valoreDaLettura('d10', 'unita', 0), 0);
    assert.equal(etichetta('d10', 'decine', 0), '00');
    assert.equal(etichetta('d10', 'decine', 4), '40');
    assert.equal(etichetta('d10', 'unita', 0), '0');
  });

  it('d100: le cento combinazioni danno 1..100, una volta ciascuna, lette dai due dadi', () => {
    const g = geometria('d10');
    const visti = new Map<number, string>();
    for (let fd = 0; fd < 10; fd++) {
      for (let fu = 0; fu < 10; fu++) {
        const ld = leggi(g, prodotto(quatDaAsseAngolo([0, 1, 0], fd), orientamentoPerFaccia(g, fd)));
        const lu = leggi(g, prodotto(quatDaAsseAngolo([0, 1, 0], -fu), orientamentoPerFaccia(g, fu)));
        const decine = valoreDaLettura('d10', 'decine', ld.lettura);
        const unita = valoreDaLettura('d10', 'unita', lu.lettura);
        const v = valoreD100(decine, unita);
        assert.ok(v >= 1 && v <= 100);
        assert.ok(!visti.has(v), `${v} due volte`);
        visti.set(v, `${decine}+${unita}`);
      }
    }
    assert.equal(visti.size, 100);
    assert.equal(valoreD100(0, 0), 100);
    assert.equal(valoreD100(0, 5), 5);
    assert.equal(valoreD100(90, 0), 90);
  });

  it('6 e 9 sottolineati sulle scritte di una cifra', () => {
    assert.ok(vaSottolineata('6'));
    assert.ok(vaSottolineata('9'));
    assert.ok(!vaSottolineata('16'));
    assert.ok(!vaSottolineata('60'));
    assert.ok(!vaSottolineata('8'));
  });
});
