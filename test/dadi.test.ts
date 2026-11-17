// Le prove della serie dei dadi del master sul ponte: quella di partenza, la scelta che arriva ai tavoli
// collegati e resta scritta accanto al registro, i nomi sconosciuti respinti, il riavvio, un file guasto.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { type Ponte } from '../src/bridge/ponte.ts';
import { type DalPonte, type RispostaStato } from '../src/shared/protocollo.ts';
import { TavoloDiProva, accendiPonte, cartellaDiProva } from './aiuti.ts';

function chiama(porta: number, metodo: 'GET' | 'POST', percorso: string, dato?: unknown): Promise<{ codice: number; json: Record<string, unknown> }> {
  return new Promise((ok, ko) => {
    const corpo = dato === undefined ? undefined : JSON.stringify(dato);
    const req = request(
      {
        host: '127.0.0.1',
        port: porta,
        method: metodo,
        path: percorso,
        headers: corpo === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(corpo)) },
      },
      (res) => {
        const pezzi: Buffer[] = [];
        res.on('data', (p: Buffer) => pezzi.push(p));
        res.on('end', () => ok({ codice: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(pezzi).toString()) as Record<string, unknown> }));
      },
    );
    req.on('error', ko);
    if (corpo !== undefined) req.write(corpo);
    req.end();
  });
}

const stato = async (porta: number) => (await chiama(porta, 'GET', '/api/stato')).json as unknown as RispostaStato;

describe('i dadi del master sul ponte', () => {
  const dir = cartellaDiProva();
  const file = join(dirname(dir.registro), 'dadi-del-master.json');
  let ponte: Ponte | undefined;
  after(async () => {
    await ponte?.ferma();
    dir.via();
  });

  it('di partenza il sangue di bue, nello stato e nel saluto al tavolo', async () => {
    ponte = await accendiPonte(dir.registro, dir.client);
    assert.equal((await stato(ponte.porta)).dadiDelMaster, 'sangue');
    const t = await TavoloDiProva.apri(ponte.porta);
    assert.equal(t.stato.dadiDelMaster, 'sangue');
    await t.chiudi();
  });

  it('la scelta arriva ai tavoli collegati e resta scritta accanto al registro', async () => {
    const p = ponte!.porta;
    const t = await TavoloDiProva.apri(p);
    const arriva = t.aspetta<Extract<DalPonte, { tipo: 'dadi del master' }>>((m) => m.tipo === 'dadi del master');
    const r = await chiama(p, 'POST', '/api/master/dadi', { serie: 'bufera' });
    assert.equal(r.codice, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json, { serie: 'bufera', tavoli: 1 });
    assert.deepEqual(await arriva, { tipo: 'dadi del master', serie: 'bufera' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { serie: 'bufera' });
    assert.equal((await stato(p)).dadiDelMaster, 'bufera');
    await t.chiudi();
  });

  it('respinge un nome che non è una serie, e la scelta di prima resta', async () => {
    const p = ponte!.porta;
    for (const corpo of [{ serie: 'master' }, { serie: 3 }, {}, { serie: 'Bufera' }]) {
      const r = await chiama(p, 'POST', '/api/master/dadi', corpo);
      assert.equal(r.codice, 400, JSON.stringify(corpo));
      assert.match(String(r.json.errore), /^serie must be one of: perla, ossidiana, zaffiro, malachite, avorio, grafite, bufera, carnevale, sangue$/);
    }
    assert.equal((await stato(p)).dadiDelMaster, 'bufera');
  });

  it('dopo un riavvio il ponte la ricorda', async () => {
    const porta = ponte!.porta;
    await ponte!.ferma();
    ponte = await accendiPonte(dir.registro, dir.client, porta);
    assert.equal((await stato(porta)).dadiDelMaster, 'bufera');
    const t = await TavoloDiProva.apri(porta);
    assert.equal(t.stato.dadiDelMaster, 'bufera');
    await t.chiudi();
  });

  it('con un file guasto riparte dal sangue di bue, e lo dice nel log', async () => {
    const porta = ponte!.porta;
    await ponte!.ferma();
    writeFileSync(file, '{"serie": "drago"');
    const righe: string[] = [];
    ponte = await accendiPonte(dir.registro, dir.client, porta, { log: (r) => righe.push(r) });
    assert.equal((await stato(porta)).dadiDelMaster, 'sangue');
    assert.ok(righe.some((r) => r === `master dice: ${file} holds no known set, using sangue`), righe.join('\n'));
  });
});
