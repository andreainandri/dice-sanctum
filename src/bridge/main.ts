// L'avvio del ponte. Variabili d'ambiente, tutte facoltative:
//   DICE_SANCTUM_PORT        la porta su 127.0.0.1 (4777; 0 per una porta libera, nelle prove)
//   DICE_SANCTUM_ROLL_LOG    il file del registro (tiri.jsonl nella cartella dei dati, vedi cartelle.ts)
//   DICE_SANCTUM_CLIENT_DIR  la cartella della pagina costruita (dist/client del progetto)
// Quando ascolta scrive su stdout una riga «bridge ready at http://127.0.0.1:PORTA».

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORTA_DEL_PONTE } from '../shared/protocollo.ts';
import { cartellaDeiDati } from './cartelle.ts';
import { Ponte } from './ponte.ts';

const ambiente = process.env;
const porta = ambiente.DICE_SANCTUM_PORT === undefined ? PORTA_DEL_PONTE : Number(ambiente.DICE_SANCTUM_PORT);
if (!Number.isInteger(porta) || porta < 0 || porta > 65535) {
  console.error(`DICE_SANCTUM_PORT is not a valid port: ${ambiente.DICE_SANCTUM_PORT}`);
  process.exit(2);
}
const registro = ambiente.DICE_SANCTUM_ROLL_LOG ?? join(cartellaDeiDati(), 'tiri.jsonl');
const cartellaClient = ambiente.DICE_SANCTUM_CLIENT_DIR ?? fileURLToPath(new URL('../../dist/client', import.meta.url));

const ponte = new Ponte({ porta, registro, cartellaClient });
try {
  const vera = await ponte.avvia();
  console.log(`${new Date().toISOString()} bridge ready at http://127.0.0.1:${vera}`);
} catch (e) {
  const codice = (e as NodeJS.ErrnoException).code;
  console.error(
    codice === 'EADDRINUSE'
      ? `port ${porta} is already in use: a bridge is already running, or another program holds that port`
      : `the bridge does not start: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}

let fermando = false;
const ferma = (segnale: string) => {
  if (fermando) return;
  fermando = true;
  console.log(`${new Date().toISOString()} ${segnale}: stopping the bridge`);
  ponte.ferma().then(
    () => process.exit(0),
    (e: unknown) => {
      console.error(`unclean shutdown: ${String(e)}`);
      process.exit(1);
    },
  );
};
process.on('SIGINT', () => ferma('SIGINT'));
process.on('SIGTERM', () => ferma('SIGTERM'));
