// La veste della torre è soltanto disegno: queste prove controllano che resti al suo posto, sulla facciata e
// intorno alla torre, senza coprire l'arco da cui escono i dadi né entrare nella corte.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACCIATA, campoDellaTarga, pezziDellaFacciata, quotaDiTaglio, quotaMarcapiano } from '../src/client/facciata.ts';
import { FISICA } from '../src/physics/config.ts';
import { misureTorre } from '../src/physics/torre.ts';

const t = misureTorre(FISICA);
const P = FISICA.torre.parete;
const BASE = FISICA.vassoio.sponda;
const pezzi = pezziDellaFacciata(t, P, BASE);

/** I vertici di tutti i pezzi, come terne. */
function vertici(): [number, number, number][] {
  const esce: [number, number, number][] = [];
  for (const { geometria } of pezzi) {
    const p = geometria.getAttribute('position');
    for (let i = 0; i < p.count; i++) esce.push([p.getX(i), p.getY(i), p.getZ(i)]);
  }
  return esce;
}

test('la veste ha pezzi di noce, il campo delle targhe e i filetti d’ottone', () => {
  const materiali = new Set(pezzi.map((p) => p.materiale));
  assert.deepEqual([...materiali].sort(), ['campo', 'noce', 'ottone']);
  for (const { geometria } of pezzi) {
    const p = geometria.getAttribute('position');
    assert.ok(p.count >= 3);
    for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)));
    const n = geometria.getAttribute('normal');
    assert.ok(n, 'ogni pezzo ha le normali');
    for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, 'normale di lunghezza 1');
  }
});

test('niente copre l’arco: sotto la sua cima, fra i pennacchi, la luce resta libera', () => {
  const r = FACCIATA.pennacchio;
  for (const [x, y, z] of vertici()) {
    const nellaLuce = Math.abs(x) < t.x1 - r - 1e-6 && y < t.arco - 1e-6 && z > t.z1 - 1e-6;
    assert.ok(!nellaLuce, `un vertice sta nella luce dell’arco: ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
  }
});

test('i pennacchi non scendono sotto la cima dell’arco di più del loro raggio', () => {
  for (const [x, y, z] of vertici()) {
    if (Math.abs(x) < t.x1 - 1e-6 && z > t.z1 - 1e-6 && y < t.arco - 1e-6) assert.ok(y >= t.arco - FACCIATA.pennacchio - 1e-6);
  }
});

test('la veste sporge sulla corte meno di una mano: mai oltre il più sporgente dei suoi profili', () => {
  const massimo = Math.max(FACCIATA.cima.sporge, FACCIATA.marcapiano.sporge, FACCIATA.architrave.sporge, FACCIATA.targa.rilievo);
  for (const [, y, z] of vertici()) {
    assert.ok(z <= t.z2 + massimo + 1e-6, `sporge troppo: z ${z.toFixed(2)}`);
    assert.ok(y <= t.alta + 1e-6 && y >= BASE - 1e-6, `fuori dalla torre in altezza: y ${y.toFixed(2)}`);
  }
});

test('la targa sta sulla facciata, sopra l’architrave e sotto il marcapiano, e il taglio dell’inquadratura la tiene intera', () => {
  const c = campoDellaTarga(t);
  const m = quotaMarcapiano(t);
  assert.equal(c.z, t.z2);
  assert.ok(c.y - c.alto / 2 - FACCIATA.targa.cornice >= t.arco + FACCIATA.architrave.alto - 1e-6, 'la cornice della targa sta sopra l’architrave');
  assert.ok(c.y + c.alto / 2 + FACCIATA.targa.cornice <= m.da + 1e-6, 'e sotto il marcapiano');
  assert.ok(Math.abs(c.x) + c.largo / 2 + FACCIATA.targa.cornice <= (t.x1 - t.x0) / 2 + P);
  assert.ok(quotaDiTaglio(t) > c.y + c.alto / 2 + FACCIATA.targa.cornice && quotaDiTaglio(t) <= m.a);
  assert.ok(m.a < t.alta - FACCIATA.cima.alta, 'fra marcapiano e cornice di cima resta il piano di sopra');
});
