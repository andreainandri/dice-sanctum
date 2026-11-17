// Gli urti ricavati dal moto: che cosa conta come urto, di che tipo è, e che cosa non lo è.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FISICA } from '../src/physics/config.ts';
import { misureCorte, misureTorre } from '../src/physics/torre.ts';
import { type Urto, Urti } from '../src/physics/urti.ts';
import { geometria } from '../src/shared/dadi.ts';
import { type V3 } from '../src/shared/vettori.ts';

const DT = FISICA.passo;
const G = FISICA.gravita;
const R6 = geometria('d6').raggio;
const corte = misureCorte(FISICA);
const torre = misureTorre(FISICA);
/** Un punto in mezzo alla corte, all'altezza di un d6 posato. */
const IN_CORTE: V3 = [0, R6, (corte.z0 + corte.z1) / 2];

/** Fa correre un dado solo lungo le posizioni date e raccoglie gli urti. */
function corri(posizioni: readonly V3[], dt = DT, altri: readonly V3[] = []): Urto[] {
  const u = new Urti(FISICA, ['d6', ...altri.map(() => 'd6' as const)]);
  return posizioni.flatMap((p) => u.passo([p, ...altri], dt));
}

/** Le posizioni di un moto a velocità che cambia di colpo al passo `quando`: prima `v0`, poi `v1`, con la gravità se `cade`. */
function moto(da: V3, v0: V3, v1: V3, quando: number, passi: number, cade: boolean, dt = DT): V3[] {
  const p: [number, number, number] = [...da];
  let v: [number, number, number] = [...v0];
  const esce: V3[] = [[...p]];
  for (let k = 1; k <= passi; k++) {
    if (k === quando) v = [...v1];
    if (cade) v[1] -= G * dt;
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;
    esce.push([...p]);
  }
  return esce;
}

test('un dado in caduta libera non fa urti', () => {
  assert.deepEqual(corri(moto([0, 30, IN_CORTE[2]], [5, -40, 3], [5, -40, 3], 0, 40, true)), []);
});

test('un dado fermo sul fondo non fa urti', () => {
  assert.deepEqual(corri(Array.from({ length: 60 }, () => IN_CORTE)), []);
});

test('un dado che rotola piano non fa urti', () => {
  // Piccoli cambi di velocità a ogni passo, sotto la soglia.
  const p: V3[] = [];
  let x = 0;
  for (let k = 0; k < 80; k++) {
    x += (20 + (k % 2 === 0 ? 6 : -6)) * DT;
    p.push([x, R6, IN_CORTE[2]]);
  }
  assert.deepEqual(corri(p), []);
});

test('un rimbalzo sul fondo della corte è un urto sul fondo', () => {
  const urti = corri(moto([3, R6, IN_CORTE[2]], [0, -120, 0], [0, 60, 0], 6, 12, false));
  assert.equal(urti.length, 1);
  assert.equal(urti[0]!.tipo, 'fondo');
  assert.equal(urti[0]!.nellaTorre, false);
  assert.ok(urti[0]!.forza > 0.3 && urti[0]!.forza < 1, `forza ${urti[0]!.forza}`);
  assert.ok(Math.abs(urti[0]!.lato - 3 / (FISICA.vassoio.larghezza / 2)) < 0.05);
});

test('un urto più violento suona più forte, fino a 1', () => {
  const piano = corri(moto(IN_CORTE, [0, -40, 0], [0, 15, 0], 6, 12, false))[0]!;
  const forte = corri(moto(IN_CORTE, [0, -120, 0], [0, 60, 0], 6, 12, false))[0]!;
  const fortissimo = corri(moto(IN_CORTE, [0, -400, 0], [0, 200, 0], 6, 12, false))[0]!;
  assert.ok(piano.forza < forte.forza && forte.forza < fortissimo.forza);
  assert.equal(fortissimo.forza, 1);
});

test('un colpo di lato contro la sponda è legno', () => {
  const urti = corri(moto([12, R6, IN_CORTE[2]], [150, 0, 0], [-70, 0, 0], 6, 12, false));
  assert.equal(urti.length, 1);
  assert.equal(urti[0]!.tipo, 'sponda');
});

test('un colpo di lato accanto a un altro dado è resina', () => {
  const vicino: V3 = [1.9 * R6 + 150 * DT * 5, R6, IN_CORTE[2]];
  const urti = corri(moto([0, R6, IN_CORTE[2]], [150, 0, 0], [-40, 0, 0], 6, 12, false), DT, [vicino]);
  assert.equal(urti.length, 1);
  assert.equal(urti[0]!.tipo, 'dado');
});

test('dentro la torre anche un rimbalzo dal basso è legno, e si sa che è nella torre', () => {
  const z = (torre.z0 + torre.z1) / 2;
  const urti = corri(moto([0, R6, z], [0, -120, 0], [0, 60, 0], 6, 12, false));
  assert.equal(urti.length, 1);
  assert.equal(urti[0]!.tipo, 'sponda');
  assert.equal(urti[0]!.nellaTorre, true);
});

test('un dado spostato a mano non fa urti per il salto', () => {
  const u = new Urti(FISICA, ['d6']);
  const urti: Urto[] = [];
  const cade = moto([0, 30, IN_CORTE[2]], [0, -50, 0], [0, -50, 0], 0, 10, true);
  for (const p of cade) urti.push(...u.passo([p], DT));
  u.salta(0);
  for (const p of moto([8, 31, torre.z0 + 2], [0, -60, 0], [0, -60, 0], 0, 10, true)) urti.push(...u.passo([p], DT));
  assert.deepEqual(urti, []);
});

test('lo stesso rimbalzo si riconosce anche a sessanta fotogrammi al secondo', () => {
  const urti = corri(moto(IN_CORTE, [0, -120, 0], [0, 60, 0], 4, 8, false, 1 / 60), 1 / 60);
  assert.equal(urti.length, 1);
  assert.equal(urti[0]!.tipo, 'fondo');
});

test('due urti dello stesso dado a un passo di distanza suonano una volta sola, salvo che il secondo sia ben più forte', () => {
  // Due cambi di velocità uguali, a un passo l'uno dall'altro.
  const uguali: V3[] = [];
  const piuForte: V3[] = [];
  const v = [60, -20, 60, -20];
  const w = [60, -20, 300, -20];
  let x = 0;
  let y = 0;
  for (let k = 0; k < 12; k++) {
    x += (k < 4 ? v[0]! : k === 4 ? v[1]! : k === 5 ? v[2]! : v[3]!) * DT;
    y += (k < 4 ? w[0]! : k === 4 ? w[1]! : k === 5 ? w[2]! : w[3]!) * DT;
    uguali.push([x, R6, IN_CORTE[2]]);
    piuForte.push([y, R6, IN_CORTE[2]]);
  }
  assert.equal(corri(uguali).length, 1);
  assert.equal(corri(piuForte).length, 2);
});
