// `npm start`: il ponte e il tavolo con un comando solo, su Linux, macOS e Windows.
// Se sulla porta risponde già il ponte, apre soltanto il tavolo (quando nessun browser lo tiene aperto);
// se risponde un altro programma, si ferma. Altrimenti ricostruisce la pagina quando il codice è più nuovo
// di quella costruita, accende il ponte in primo piano (Ctrl+C lo spegne) e apre il tavolo appena è pronto.
// Le variabili d'ambiente del ponte (DICE_SANCTUM_PORT e le altre) valgono anche qui.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { PORTA_DEL_PONTE } from '../shared/protocollo.ts';

const progetto = fileURLToPath(new URL('../..', import.meta.url));
const porta = process.env.DICE_SANCTUM_PORT === undefined ? PORTA_DEL_PONTE : Number(process.env.DICE_SANCTUM_PORT);
if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  console.error(`DICE_SANCTUM_PORT is not a valid port: ${process.env.DICE_SANCTUM_PORT}`);
  process.exit(2);
}
const indirizzo = `http://127.0.0.1:${porta}`;

type Risposta = { ponte: true; tavoli: number } | { ponte: false; occupata: boolean };

/** Chi risponde sulla porta: il ponte (con quanti tavoli ha), un altro programma, o nessuno. */
async function chiRisponde(): Promise<Risposta> {
  try {
    const r = await fetch(`${indirizzo}/api/stato`, { signal: AbortSignal.timeout(2000) });
    const dato = (await r.json()) as { ultimoSeq?: unknown; tavoli?: unknown };
    if (typeof dato.ultimoSeq === 'number' && typeof dato.tavoli === 'number') return { ponte: true, tavoli: dato.tavoli };
  } catch (e) {
    // Connessione rifiutata: la porta è libera. Tempo scaduto o risposta strana: c'è qualcun altro.
    if ((e as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED') return { ponte: false, occupata: false };
  }
  return { ponte: false, occupata: true };
}

/** L'ultima modifica fra i file di una cartella, sottocartelle comprese. */
function piuRecente(cartella: string): number {
  let ultimo = 0;
  for (const voce of readdirSync(cartella, { withFileTypes: true, recursive: true })) {
    if (voce.isFile()) ultimo = Math.max(ultimo, statSync(join(voce.parentPath, voce.name)).mtimeMs);
  }
  return ultimo;
}

/** La pagina si ricostruisce quando manca o quando il codice del tavolo è più nuovo. */
function costruisciSeServe(): void {
  const pagina = join(progetto, 'dist', 'client', 'index.html');
  const sorgenti = ['src/client', 'src/physics', 'src/shared'].map((c) => piuRecente(join(progetto, c)));
  if (existsSync(pagina) && Math.max(...sorgenti) <= statSync(pagina).mtimeMs) return;
  console.log('Building the page...');
  const vite = join(progetto, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) {
    console.error('Vite is missing: run npm install first.');
    process.exit(1);
  }
  const esito = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: progetto, stdio: 'inherit' });
  if (esito.status !== 0) {
    console.error('The page does not build: see the messages above.');
    process.exit(1);
  }
}

/** Il tavolo nel browser predefinito; se non si apre, l'indirizzo resta scritto per aprirlo a mano. */
function apriIlTavolo(): void {
  const [comando, argomenti]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', indirizzo]]
      : process.platform === 'darwin'
        ? ['open', [indirizzo]]
        : ['xdg-open', [indirizzo]];
  try {
    const p = spawn(comando, argomenti, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true });
    p.on('error', () => console.log(`Open ${indirizzo} in a browser.`));
    p.unref();
  } catch {
    console.log(`Open ${indirizzo} in a browser.`);
  }
}

const adesso = await chiRisponde();
if (adesso.ponte) {
  if (adesso.tavoli > 0) {
    console.log(`The Dice Sanctum is already running at ${indirizzo}, and a browser has the table open.`);
  } else {
    console.log(`The Dice Sanctum is already running at ${indirizzo}: opening the table.`);
    apriIlTavolo();
  }
  process.exit(0);
}
if (adesso.occupata) {
  console.error(`Another program answers on port ${porta}: the bridge cannot start. DICE_SANCTUM_PORT chooses another port.`);
  process.exit(1);
}

costruisciSeServe();
const ponte = spawn(process.execPath, [join(progetto, 'src', 'bridge', 'main.ts')], { cwd: progetto, stdio: ['ignore', 'pipe', 'inherit'] });
let aperto = false;
createInterface({ input: ponte.stdout }).on('line', (riga) => {
  console.log(riga);
  if (!aperto && riga.includes('bridge ready at')) {
    aperto = true;
    console.log(`The Dice Sanctum is at ${indirizzo}. Ctrl+C stops the bridge.`);
    apriIlTavolo();
  }
});
// Ctrl+C nel terminale arriva anche al ponte, che si spegne da sé chiudendo bene il registro; qui si aspetta
// la sua uscita. Un segnale mandato soltanto a questo processo passa al ponte (non su Windows, dove
// inoltrarlo vorrebbe dire chiuderlo di colpo, e Ctrl+C gli arriva comunque).
process.on('SIGINT', () => {
  if (process.platform !== 'win32') ponte.kill('SIGINT');
});
process.on('SIGTERM', () => ponte.kill('SIGTERM'));
ponte.on('exit', (codice) => process.exit(codice ?? 0));
