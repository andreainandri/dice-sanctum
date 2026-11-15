import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calcola } from '../src/shared/conto.ts';
import { numera, tiroDalTavolo } from '../src/shared/eventi.ts';
import { leggiFormula } from '../src/shared/notazione.ts';

describe('eventi', () => {
  it('il tiro esce identico alla riga d’esempio del PROMPT, chiavi in ordine', () => {
    const f = leggiFormula('2d20kh1+5');
    const conto = calcola(f, [
      [
        { value: 17, rethrows: 0 },
        { value: 9, rethrows: 1 },
      ],
    ]);
    const e = numera(tiroDalTavolo({ id: '3f6c2a9e-...', at: '...', label: 'Attacco', formula: f, requestId: 'r-0007', conto }), 143);
    assert.equal(
      JSON.stringify(e),
      '{"v":1,"seq":143,"type":"roll.completed","id":"3f6c2a9e-...","at":"...","summary":"Attacco 2d20kh1+5: [17 (9)] +5 = 22","label":"Attacco","formula":"2d20kh1+5","requestId":"r-0007","groups":[{"sign":1,"count":2,"sides":20,"keep":{"mode":"kh","n":1},"dice":[{"value":17,"kept":true,"rethrows":0},{"value":9,"kept":false,"rethrows":1}]}],"constant":5,"total":22,"nat20":false,"nat1":false}',
    );
  });

  it('numera mette il seq dopo la v anche quando c’era già', () => {
    const e = numera(numera({ v: 1 as const, type: 'request.cancelled', requestId: 'r-0008', at: '...' }, 149), 150);
    assert.equal(JSON.stringify(e), '{"v":1,"seq":150,"type":"request.cancelled","requestId":"r-0008","at":"..."}');
  });
});
