// Dove stanno i dati del Dice Sanctum (il registro dei tiri), secondo il sistema:
//   Linux e gli altri   $XDG_DATA_HOME/dice-sanctum, o ~/.local/share/dice-sanctum
//   macOS               ~/Library/Application Support/dice-sanctum
//   Windows             %APPDATA%\dice-sanctum

import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export function cartellaDeiDati(
  sistema: NodeJS.Platform = process.platform,
  ambiente: NodeJS.ProcessEnv = process.env,
  casa: string = homedir(),
): string {
  if (sistema === 'win32') return win32.join(ambiente.APPDATA || win32.join(casa, 'AppData', 'Roaming'), 'dice-sanctum');
  if (sistema === 'darwin') return posix.join(casa, 'Library', 'Application Support', 'dice-sanctum');
  // La specifica XDG vuole un percorso assoluto; uno relativo si ignora.
  const xdg = ambiente.XDG_DATA_HOME;
  return posix.join(xdg && xdg.startsWith('/') ? xdg : posix.join(casa, '.local', 'share'), 'dice-sanctum');
}
