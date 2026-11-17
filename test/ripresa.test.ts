// La ripresa di un lancio: quello che il tavolo mostra coi dadi del master. I dadi della ripresa si
// fermano sulle facce che il lancio ha letto, e un dado ritirato salta senza scivolare.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { daBase64, inBase64 } from '../src/shared/base64.ts';
import { geometria } from '../src/shared/dadi.ts';
import { leggi } from '../src/shared/lettura.ts';
import { leggiFormula } from '../src/shared/notazione.ts';
import { fonteDaSeme } from '../src/physics/casuale.ts';
import { FISICA } from '../src/physics/config.ts';
import { RipresaLetta, riprendi } from '../src/physics/ripresa.ts';
import { specsDaFormula } from '../src/physics/tiro.ts';
import { Vassoio, caricaRapier } from '../src/physics/vassoio.ts';

const R = await caricaRapier();
const vassoio = new Vassoio(R);
after(() => vassoio.libera());

describe('la ripresa di un lancio', () => {
  it('base64 e ritorno, anche oltre un pezzo', () => {
    const bytes = new Uint8Array(70000).map((_, i) => (i * 31) % 256);
    assert.deepEqual(daBase64(inBase64(bytes)), bytes);
    assert.equal(inBase64(new Uint8Array(0)), '');
  });

  it('l’ultimo fotogramma mostra le facce che il lancio ha letto, per ogni forma', () => {
    const specs = specsDaFormula(leggiFormula('1d4+1d6+1d8+1d10+1d12+1d20+1d100'));
    for (const seme of [3, 11, 29, 71, 113]) {
      const esito = riprendi(vassoio, specs, fonteDaSeme(seme));
      assert.equal(esito.stato, 'fermo');
      if (esito.stato !== 'fermo') return;
      const letta = new RipresaLetta(esito.ripresa);
      const ultimo = esito.ripresa.fotogrammi - 1;
      assert.equal(esito.letture.length, specs.length);
      for (const l of esito.letture) {
        const { q } = letta.posa(ultimo, l.indice);
        assert.equal(leggi(geometria(l.spec.forma), q).faccia, l.faccia, `seme ${seme}, dado ${l.indice} (${l.spec.forma})`);
      }
      vassoio.pulisci();
    }
  });

  it('parte dal lancio, dura quanto i fotogrammi, e finisce a dadi posati', () => {
    const specs = specsDaFormula(leggiFormula('2d6'));
    const esito = riprendi(vassoio, specs, fonteDaSeme(5));
    assert.equal(esito.stato, 'fermo');
    if (esito.stato !== 'fermo') return;
    const r = esito.ripresa;
    assert.deepEqual(r.dadi, specs);
    assert.equal(r.passo, FISICA.passo * 2);
    assert.ok(Math.abs(esito.durata - (r.fotogrammi - 1) * r.passo) < 1e-9);
    const letta = new RipresaLetta(r);
    assert.equal(letta.durata, esito.durata);
    for (let i = 0; i < specs.length; i++) {
      // In partenza i dadi stanno in aria sopra il fondo; alla fine posano, a mezzo spigolo d'altezza.
      assert.ok(letta.posa(0, i).p[1] > 3, `dado ${i} parte da ${letta.posa(0, i).p[1]}`);
      assert.ok(Math.abs(letta.posa(r.fotogrammi - 1, i).p[1] - 0.95) < 0.05, `dado ${i} finisce a ${letta.posa(r.fotogrammi - 1, i).p[1]}`);
      const q = letta.posa(r.fotogrammi - 1, i).q;
      assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-5);
    }
    assert.deepEqual(r.salti, []);
    vassoio.pulisci();
  });

  it('un dado ritirato lascia un salto: fra i due fotogrammi non si interpola', () => {
    const specs = specsDaFormula(leggiFormula('2d20'));
    let primaVolta = true;
    const esito = riprendi(vassoio, specs, fonteDaSeme(9), {
      // La prima quiete del dado 1 è dichiarata storta: il vassoio lo ritira una volta.
      controlloStorto: (i) => {
        if (i !== 1 || !primaVolta) return false;
        primaVolta = false;
        return true;
      },
    });
    assert.equal(esito.stato, 'fermo');
    if (esito.stato !== 'fermo') return;
    assert.equal(esito.ripresa.salti.length, 1);
    const [f, dado] = esito.ripresa.salti[0]!;
    assert.equal(dado, 1);
    const letta = new RipresaLetta(esito.ripresa);
    assert.equal(letta.salta(f, 1), true);
    assert.equal(letta.salta(f, 0), false);
    assert.equal(letta.salta(f - 1, 1), false);
    // Fermo sul fondo un fotogramma, in aria quello dopo.
    assert.ok(letta.posa(f, 1).p[1] - letta.posa(f - 1, 1).p[1] > 2, `da ${letta.posa(f - 1, 1).p[1]} a ${letta.posa(f, 1).p[1]}`);
    assert.equal(esito.letture.find((l) => l.indice === 1)?.ritiri, 1);
    vassoio.pulisci();
  });

  it('una ripresa guasta non si legge', () => {
    const esito = riprendi(vassoio, specsDaFormula(leggiFormula('1d6')), fonteDaSeme(2));
    assert.equal(esito.stato, 'fermo');
    if (esito.stato !== 'fermo') return;
    const r = esito.ripresa;
    assert.throws(() => new RipresaLetta({ ...r, fotogrammi: r.fotogrammi + 1 }), /misura/);
    assert.throws(() => new RipresaLetta({ ...r, dadi: [...r.dadi, ...r.dadi] }), /misura/);
    assert.throws(() => new RipresaLetta({ ...r, pose: r.pose.slice(0, -8) }), /misura/);
    assert.throws(() => new RipresaLetta({ ...r, pose: '%%%' }));
    assert.throws(() => new RipresaLetta({ ...r, fotogrammi: 0 }), /senza fotogrammi/);
    assert.throws(() => new RipresaLetta({ ...r, dadi: [] }), /senza fotogrammi/);
    vassoio.pulisci();
  });
});
