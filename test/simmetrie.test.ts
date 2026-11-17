import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { FORME, type Forma, geometria } from '../src/shared/dadi.ts';
import { leggi } from '../src/shared/lettura.ts';
import { rotazioniDelSolido } from '../src/shared/simmetrie.ts';
import { type V3, prodotto, ruota } from '../src/shared/vettori.ts';
import { fonteDaSeme } from '../src/physics/casuale.ts';
import { Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

const R = await caricaRapier();
const vassoi: Vassoio[] = [];
after(() => {
  for (const v of vassoi) v.libera();
});

const ORDINE: Record<Forma, number> = { d4: 12, d6: 24, d8: 24, d10: 10, d12: 60, d20: 60 };
const vicini = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

describe('le simmetrie dei dadi', () => {
  for (const forma of FORME) {
    it(`${forma}: ${ORDINE[forma]} rotazioni, ognuna porta il solido su sé stesso`, () => {
      const g = geometria(forma);
      const G = rotazioniDelSolido(forma);
      assert.equal(G.length, ORDINE[forma]);
      for (const q of G) {
        assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-9);
        for (const p of g.vertici) assert.ok(g.vertici.some((u) => vicini(ruota(q, p), u)), 'un vertice finisce fuori dai vertici');
        for (const n of g.normali) assert.ok(g.normali.some((m) => vicini(ruota(q, n), m)), 'una faccia finisce fuori dalle facce');
      }
    });

    it(`${forma}: ogni faccia va su ogni altra lo stesso numero di volte`, () => {
      const g = geometria(forma);
      const G = rotazioniDelSolido(forma);
      for (let i = 0; i < g.normali.length; i++) {
        const arrivi = g.normali.map(() => 0);
        for (const q of G) arrivi[g.normali.findIndex((m) => vicini(ruota(q, g.normali[i]!), m))]! += 1;
        assert.deepEqual(arrivi, g.normali.map(() => G.length / g.normali.length));
      }
    });

    it(`${forma}: il gruppo è chiuso`, () => {
      const G = rotazioniDelSolido(forma);
      const cè = (q: { x: number; y: number; z: number; w: number }) => G.some((t) => Math.abs(t.w * q.w + t.x * q.x + t.y * q.y + t.z * q.z) > 1 - 1e-9);
      for (const a of G) for (const b of G) assert.ok(cè(prodotto(a, b)));
    });
  }

  it('a ogni lancio il giro è una rotazione del solido, e cambia da un lancio all’altro', () => {
    const v = new Vassoio(R);
    vassoi.push(v);
    const fonte = fonteDaSeme(21);
    const visti = new Set<number>();
    const G = rotazioniDelSolido('d20');
    for (let k = 0; k < 40; k++) {
      const l = v.lancia([{ forma: 'd20', ruolo: 'semplice' }], fonte);
      const giro = v.dadi[0]!.giro;
      const quale = G.findIndex((t) => Math.abs(t.w * giro.w + t.x * giro.x + t.y * giro.y + t.z * giro.z) > 1 - 1e-9);
      assert.ok(quale >= 0);
      visti.add(quale);
      assert.equal(l.finoAllaFine(), 'fermo');
      // Il numero letto è quello della faccia che il disegno mostra in alto: corpo e giro insieme.
      const d = v.dadi[0]!;
      assert.equal(l.letture![0]!.lettura, leggi(geometria('d20'), v.posa(d).q).lettura);
      assert.equal(l.letture![0]!.lettura, leggi(geometria('d20'), prodotto(d.corpo.rotation(), d.giro)).lettura);
    }
    assert.ok(visti.size > 15, `giri diversi: ${visti.size}`);
  });
});
