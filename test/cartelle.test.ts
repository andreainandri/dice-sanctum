import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartellaDeiDati } from '../src/bridge/cartelle.ts';

describe('la cartella dei dati', () => {
  it('su Linux segue XDG_DATA_HOME, se è un percorso assoluto', () => {
    assert.equal(cartellaDeiDati('linux', {}, '/home/ada'), '/home/ada/.local/share/dice-sanctum');
    assert.equal(cartellaDeiDati('linux', { XDG_DATA_HOME: '/dati' }, '/home/ada'), '/dati/dice-sanctum');
    assert.equal(cartellaDeiDati('linux', { XDG_DATA_HOME: 'relativa' }, '/home/ada'), '/home/ada/.local/share/dice-sanctum');
    assert.equal(cartellaDeiDati('freebsd', {}, '/home/ada'), '/home/ada/.local/share/dice-sanctum');
  });

  it('su macOS e Windows, dove li tengono i programmi', () => {
    assert.equal(cartellaDeiDati('darwin', {}, '/Users/ada'), '/Users/ada/Library/Application Support/dice-sanctum');
    assert.equal(cartellaDeiDati('win32', { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, 'C:\\Users\\ada'), 'C:\\Users\\ada\\AppData\\Roaming\\dice-sanctum');
    assert.equal(cartellaDeiDati('win32', {}, 'C:\\Users\\ada'), 'C:\\Users\\ada\\AppData\\Roaming\\dice-sanctum');
  });
});
