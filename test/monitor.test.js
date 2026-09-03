import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Alerter, BotWatch, observeTelegram } from '../src/monitor.js';

const opts = { stuck_checks: 3, restart_cooldown_seconds: 600 };
const quiet = { warn() {}, info() {}, error() {} };

test('healthy bot: empty queue never triggers anything', () => {
  const w = new BotWatch('A', opts);
  for (let i = 0; i < 10; i++) {
    const r = w.observe({ tokenOk: true, pending: 0, pm2Status: 'online' });
    assert.deepEqual(r, { restart: false, alerts: [], recovered: false });
  }
});

test('a queue that keeps growing triggers a restart after stuck_checks', () => {
  const w = new BotWatch('A', opts);
  let r = w.observe({ tokenOk: true, pending: 1 }, 1000);
  assert.equal(r.restart, false);
  r = w.observe({ tokenOk: true, pending: 2 }, 2000);
  assert.equal(r.restart, false);
  r = w.observe({ tokenOk: true, pending: 2 }, 3000);
  assert.equal(r.restart, true);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /Restarting/);
});

test('a queue that drains resets the counter', () => {
  const w = new BotWatch('A', opts);
  w.observe({ tokenOk: true, pending: 3 }, 1000);
  w.observe({ tokenOk: true, pending: 5 }, 2000);
  w.observe({ tokenOk: true, pending: 1 }, 3000);   // dropped: someone is draining
  const r = w.observe({ tokenOk: true, pending: 1 }, 4000);
  assert.equal(r.restart, false);
});

test('no second restart inside the cooldown, but one alert that it is still stuck', () => {
  const w = new BotWatch('A', opts);
  const t = 100_000;
  w.observe({ tokenOk: true, pending: 1 }, t);
  w.observe({ tokenOk: true, pending: 1 }, t + 1000);
  let r = w.observe({ tokenOk: true, pending: 1 }, t + 2000);
  assert.equal(r.restart, true);
  // still stuck right after the restart
  r = w.observe({ tokenOk: true, pending: 1 }, t + 3000);
  w.observe({ tokenOk: true, pending: 1 }, t + 4000);
  r = w.observe({ tokenOk: true, pending: 1 }, t + 5000);
  assert.equal(r.restart, false);
  assert.deepEqual(r.alerts, []);            // already flagged unhealthy, no spam
  // still stuck when the cooldown expires: restart again, and say so
  r = w.observe({ tokenOk: true, pending: 1 }, t + 700_000);
  assert.equal(r.restart, true);
  assert.equal(r.alerts.length, 1);
  assert.match(r.alerts[0], /Restarting/);
});

test('recovery is reported once', () => {
  const w = new BotWatch('A', opts);
  w.observe({ tokenOk: true, pending: 1 }, 1000);
  w.observe({ tokenOk: true, pending: 1 }, 2000);
  w.observe({ tokenOk: true, pending: 1 }, 3000);
  let r = w.observe({ tokenOk: true, pending: 0 }, 4000);
  assert.equal(r.recovered, true);
  assert.match(r.alerts[0], /recovered/);
  r = w.observe({ tokenOk: true, pending: 0 }, 5000);
  assert.deepEqual(r.alerts, []);
});

test('pm2 stopped/errored triggers restart and alert; bad token alerts without restart', () => {
  let w = new BotWatch('A', opts);
  let r = w.observe({ tokenOk: true, pending: 0, pm2Status: 'errored' }, 1000);
  assert.equal(r.restart, true);
  assert.match(r.alerts[0], /errored/);

  w = new BotWatch('B', opts);
  r = w.observe({ tokenOk: false }, 1000);
  assert.equal(r.restart, false);
  assert.match(r.alerts[0], /token/);
});

test('Telegram unreachable is neither a restart nor an alert', () => {
  const w = new BotWatch('A', opts);
  const r = w.observe({ apiError: 'fetch failed' });
  assert.deepEqual(r, { restart: false, alerts: [], recovered: false });
});

test('Alerter de-duplicates identical messages inside the repeat window', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true }; };
  const a = new Alerter({ token: 't', chatId: '42', repeatSeconds: 60, fetchImpl, log: quiet });
  assert.equal(await a.send('down', 1000), true);
  assert.equal(await a.send('down', 2000), false);
  assert.equal(await a.send('down', 70_000), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].chat_id, '42');
  assert.match(sent[0].text, /^cardbot-monitor: down/);
});

test('Alerter without a chat id logs but does not send', async () => {
  let called = false;
  const a = new Alerter({ token: 't', chatId: undefined, fetchImpl: async () => { called = true; }, log: quiet });
  assert.equal(a.enabled, false);
  assert.equal(await a.send('x'), false);
  assert.equal(called, false);
});

test('observeTelegram maps API responses', async () => {
  const mk = (body) => async () => ({ json: async () => body });
  assert.deepEqual(await observeTelegram('t', mk({ ok: true, result: { pending_update_count: 4 } })), { tokenOk: true, pending: 4 });
  assert.deepEqual(await observeTelegram('t', mk({ ok: false, error_code: 401, description: 'Unauthorized' })), { tokenOk: false });
  assert.deepEqual(await observeTelegram('t', mk({ ok: false, error_code: 502, description: 'Bad Gateway' })), { apiError: '502 Bad Gateway' });
  assert.deepEqual(await observeTelegram('t', async () => { throw new Error('fetch failed'); }), { apiError: 'fetch failed' });
});
