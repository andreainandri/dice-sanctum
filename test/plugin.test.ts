// Il plugin di Claude Code è il progetto stesso: queste prove tengono insieme il manifesto, l'elenco del
// marketplace, il pacchetto e i file a cui puntano.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const progetto = fileURLToPath(new URL('..', import.meta.url));
const leggi = (percorso: string) => JSON.parse(readFileSync(join(progetto, percorso), 'utf8'));
const manifesto = leggi('.claude-plugin/plugin.json');
const marketplace = leggi('.claude-plugin/marketplace.json');
const pacchetto = leggi('package.json');

test('manifesto, pacchetto e server MCP dicono la stessa versione', () => {
  assert.equal(manifesto.version, pacchetto.version);
  assert.equal(leggi('package-lock.json').version, pacchetto.version);
  assert.ok(readFileSync(join(progetto, 'src/mcp/server.ts'), 'utf8').includes(`version: '${pacchetto.version}'`));
});

test('il marketplace elenca il plugin col nome del manifesto, alla radice del progetto', () => {
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, manifesto.name);
  assert.equal(marketplace.plugins[0].source, './');
});

test('il server MCP del plugin è quello del progetto, e il canale è legato a lui', () => {
  const nomi = Object.keys(manifesto.mcpServers);
  assert.deepEqual(nomi, ['table']);
  const server = manifesto.mcpServers.table;
  assert.equal(server.command, 'node');
  assert.equal(server.args.length, 1);
  const percorso = server.args[0].replace('${CLAUDE_PLUGIN_ROOT}/', '');
  assert.ok(existsSync(join(progetto, percorso)), `manca ${percorso}`);
  assert.deepEqual(
    manifesto.channels.map((c: { server: string }) => c.server),
    ['table'],
  );
});

test('ogni valore chiesto a chi installa è dichiarato, e viceversa', () => {
  const usati = new Set([...JSON.stringify(manifesto.mcpServers).matchAll(/\$\{user_config\.(\w+)\}/g)].map((m) => m[1]));
  assert.deepEqual([...usati].sort(), Object.keys(manifesto.userConfig).sort());
});

test('quello che serve a far girare ponte, server e pagina sta fra le dipendenze di chi installa', () => {
  // Claude Code installa le dipendenze del plugin dal file di blocco, senza quelle di sviluppo.
  for (const nome of ['@dimforge/rapier3d-compat', '@modelcontextprotocol/sdk', 'three', 'vite', 'ws', 'zod']) {
    assert.match(pacchetto.dependencies[nome] ?? '', /^\d+\.\d+\.\d+$/, `${nome} manca o non è una versione esatta`);
  }
});

test('ogni skill ha la sua descrizione, e i comandi che cita esistono', () => {
  const cartelle = readdirSync(join(progetto, 'skills'));
  assert.deepEqual(cartelle.sort(), ['dm', 'table']);
  for (const nome of cartelle) {
    const testo = readFileSync(join(progetto, 'skills', nome, 'SKILL.md'), 'utf8');
    const testata = /^---\n([\s\S]*?)\n---\n/.exec(testo);
    assert.ok(testata, `${nome}: manca la testata`);
    assert.match(testata[1]!, /^description: .{40,}$/m, `${nome}: manca la descrizione`);
    for (const [, percorso] of testo.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
      assert.ok(existsSync(join(progetto, percorso!)), `${nome}: ${percorso} non esiste`);
    }
  }
});
