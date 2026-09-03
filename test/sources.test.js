import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadFolderSource } from '../src/sources/folder.js';
import { loadListSource, locateImage, normalizeEntries } from '../src/sources/list.js';
import { validateConfig } from '../src/config.js';

const quiet = { warn() {}, info() {}, error() {} };

async function tempCards() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cardbot-'));
  await writeFile(path.join(dir, 'PEPEBRAIN.png'), 'x');
  await writeFile(path.join(dir, 'pepetrash.GIF'), 'x');
  await writeFile(path.join(dir, 'notes.txt'), 'x');
  return dir;
}

test('folder source without manifest names cards after files', async () => {
  const dir = await tempCards();
  const cards = await loadFolderSource({ type: 'folder', path: dir }, { log: quiet });
  assert.deepEqual(cards.map((c) => c.name).sort(), ['PEPEBRAIN', 'pepetrash']);
  assert.equal(cards.find((c) => c.name === 'PEPEBRAIN').file, path.join(dir, 'PEPEBRAIN.png'));
});

test('folder source with manifest serves only listed cards and skips missing files', async () => {
  const dir = await tempCards();
  const manifest = path.join(dir, 'list.json');
  await writeFile(manifest, JSON.stringify({ PEPEBRAIN: 'PEPEBRAIN.png', GHOST: 'GHOST.png' }));
  const cards = await loadFolderSource({ type: 'folder', path: dir, manifest }, { log: quiet });
  assert.deepEqual(cards.map((c) => c.name), ['PEPEBRAIN']);
});

test('normalizeEntries accepts arrays, {data}, and maps', () => {
  assert.deepEqual(normalizeEntries([{ asset: 'A', image: 'a.png' }]), [{ asset: 'A', image: 'a.png' }]);
  assert.deepEqual(normalizeEntries({ data: [{ asset: 'A', image: 'a.png' }] }), [{ asset: 'A', image: 'a.png' }]);
  assert.deepEqual(normalizeEntries({ A: 'a.png' }), [{ asset: 'A', image: 'a.png' }]);
  assert.throws(() => normalizeEntries('nope'));
});

test('locateImage covers every combination of list value and images base', () => {
  assert.deepEqual(locateImage('A.png', '/img'), { file: path.join('/img', 'A.png') });
  assert.deepEqual(locateImage('A.png', 'https://x/img'), { url: 'https://x/img/A.png' });
  assert.deepEqual(locateImage('https://x/images/cards/A.png', '/img'), { file: path.join('/img', 'A.png') });
  assert.deepEqual(locateImage('https://x/images/cards/A.png', 'https://y/'), { url: 'https://x/images/cards/A.png' });
  assert.deepEqual(locateImage('https://x/images/cards/A.png', undefined), { url: 'https://x/images/cards/A.png' });
  assert.equal(locateImage('A.png', undefined), null);
});

test('list source accepts the name -> image-url map the directory sites publish', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({
    LOOTDOGE: 'https://raredogedirectory.com/images/cards/LOOTDOGE.png',
    RAREDOGECASH: 'https://raredogedirectory.com/images/cards/RAREDOGECASH.gif',
  }) });
  const cards = await loadListSource({ type: 'list', list: 'https://x/list.json', images: '/srv/cards' }, { log: quiet, fetchImpl });
  assert.deepEqual(cards.map((c) => c.name), ['LOOTDOGE', 'RAREDOGECASH']);
  assert.equal(cards[0].file, path.join('/srv/cards', 'LOOTDOGE.png'));
});

test('list source maps entries to local files or urls', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: [
    { asset: 'LOOTDOGE', image: 'LOOTDOGE.png', name: 'Loot Doge', series: '3' },
    { asset: null, image: 'RARECARD1.png' },
  ] }) });
  const local = await loadListSource({ type: 'list', list: 'https://x/list.json', images: '/img' }, { log: quiet, fetchImpl });
  assert.equal(local.length, 1);
  assert.equal(local[0].name, 'LOOTDOGE');
  assert.equal(local[0].title, 'Loot Doge');
  assert.equal(local[0].series, '3');
  assert.equal(local[0].file, path.join('/img', 'LOOTDOGE.png'));

  const remote = await loadListSource({ type: 'list', list: 'https://x/list.json', images: 'https://x/img/' }, { log: quiet, fetchImpl });
  assert.equal(remote[0].url, 'https://x/img/LOOTDOGE.png');
});

test('validateConfig applies defaults, normalizes commands, resolves paths, hides token', () => {
  process.env.TEST_BOT_TOKEN = '1:abc';
  const config = validateConfig({
    name: 'T', token_env: 'TEST_BOT_TOKEN', commands: ['/P', 'Pepe'],
    source: { type: 'folder', path: 'cards' },
  }, '/base');
  assert.deepEqual(config.commands, ['p', 'pepe']);
  assert.equal(config.source.path, path.resolve('/base', 'cards'));
  assert.equal(config.suggestions, 10);
  assert.equal(config.reply.only_when_random, true);
  assert.equal(config.token, '1:abc');
  assert.equal(JSON.stringify(config).includes('1:abc'), false);
});

test('validateConfig rejects bad input', () => {
  process.env.TEST_BOT_TOKEN = '1:abc';
  const base = { name: 'T', token_env: 'TEST_BOT_TOKEN', commands: ['p'], source: { type: 'folder', path: 'c' } };
  assert.throws(() => validateConfig({ ...base, commands: [] }), /commands/);
  assert.throws(() => validateConfig({ ...base, source: { type: 'nope' } }), /source/);
  assert.throws(() => validateConfig({ ...base, source: { type: 'list' } }), /list/);
  assert.throws(() => validateConfig({ ...base, gif_as: 'photo' }), /gif_as/);
  assert.throws(() => validateConfig({ ...base, token_env: 'DEFINITELY_UNSET_VAR' }), /not set/);
});
