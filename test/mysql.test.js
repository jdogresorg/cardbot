import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadMysqlSource } from '../src/sources/mysql.js';
import { validateConfig } from '../src/config.js';

const quiet = { warn() {}, info() {}, error() {} };

function fakeConnect(rows, calls) {
  return async (dsn) => {
    calls.push({ dsn, ended: false });
    return {
      query: async (sql) => { calls[calls.length - 1].sql = sql; return [rows]; },
      end: async () => { calls[calls.length - 1].ended = true; },
    };
  };
}

test('mysql source maps rows to cards and closes the connection', async () => {
  process.env.TEST_DB_URL = 'mysql://u:p@localhost/db';
  const calls = [];
  const rows = [
    { asset: 'BITKET', image: 'BITKET.png', series: 2 },
    { asset: 'BLACCSNACC', image: 'BLACCSNACC.png', series: 2 },
  ];
  const cards = await loadMysqlSource(
    { type: 'mysql', dsn_env: 'TEST_DB_URL', query: 'SELECT 1', images: '/img' },
    { log: quiet, connect: fakeConnect(rows, calls) },
  );
  assert.deepEqual(cards.map((c) => c.name), ['BITKET', 'BLACCSNACC']);
  assert.equal(cards[0].file, path.join('/img', 'BITKET.png'));
  assert.equal(cards[0].series, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sql, 'SELECT 1');
  assert.equal(calls[0].ended, true);
});

test('mysql source closes the connection even when the query throws', async () => {
  process.env.TEST_DB_URL = 'mysql://u:p@localhost/db';
  let ended = false;
  const connect = async () => ({ query: async () => { throw new Error('boom'); }, end: async () => { ended = true; } });
  await assert.rejects(
    () => loadMysqlSource({ type: 'mysql', dsn_env: 'TEST_DB_URL', query: 'x', images: '/img' }, { log: quiet, connect }),
    /boom/,
  );
  assert.equal(ended, true);
});

test('mysql source fails clearly when the DSN env var is missing', async () => {
  delete process.env.UNSET_DB_URL;
  await assert.rejects(
    () => loadMysqlSource({ type: 'mysql', dsn_env: 'UNSET_DB_URL', query: 'x' }, { log: quiet }),
    /UNSET_DB_URL/,
  );
});

test('validateConfig checks mysql source fields', () => {
  process.env.TEST_BOT_TOKEN = '1:abc';
  const base = { name: 'T', token_env: 'TEST_BOT_TOKEN', commands: ['k'] };
  assert.throws(() => validateConfig({ ...base, source: { type: 'mysql', query: 'x' } }), /dsn_env/);
  assert.throws(() => validateConfig({ ...base, source: { type: 'mysql', dsn_env: 'X' } }), /query/);
  const ok = validateConfig({ ...base, source: { type: 'mysql', dsn_env: 'X', query: 'x', images: 'img' } }, '/base');
  assert.equal(ok.source.images, path.resolve('/base', 'img'));
});
