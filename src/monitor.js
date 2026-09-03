/**
 * Liveness monitor for a set of cardbot instances.
 *
 * PM2 only knows whether a process exists. This watches whether each bot is
 * actually consuming its Telegram updates: getWebhookInfo reports how many
 * updates are queued, and a queue that stays non-empty (or grows) across
 * several checks means nothing is polling. On that signal the monitor
 * restarts the bot through PM2 and sends an alert. It also flags a bot whose
 * PM2 process is stopped or errored, and a token Telegram rejects.
 *
 * All I/O is injected so the decision logic can be unit-tested.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MONITOR_DEFAULTS = {
  interval_seconds: 60,
  stuck_checks: 3,
  restart_cooldown_seconds: 600,
  alert_repeat_seconds: 1800,
  pm2: true,
};

/** Per-bot state machine: decides restart/alert from one observation. */
export class BotWatch {
  constructor(name, options = {}) {
    this.name = name;
    this.stuckChecks = options.stuck_checks ?? MONITOR_DEFAULTS.stuck_checks;
    this.cooldownMs = (options.restart_cooldown_seconds ?? MONITOR_DEFAULTS.restart_cooldown_seconds) * 1000;
    this.lastPending = 0;
    this.stuckCount = 0;
    this.lastRestartAt = null;
    this.unhealthy = false;
  }

  /**
   * observation: { pending?: number, tokenOk?: boolean, pm2Status?: string, apiError?: string }
   * returns:     { restart: boolean, alerts: string[], recovered: boolean }
   */
  observe(observation, now = Date.now()) {
    const result = { restart: false, alerts: [], recovered: false };

    if (observation.apiError) {
      // Telegram itself unreachable from here: say nothing, restart nothing.
      return result;
    }
    if (observation.tokenOk === false) {
      this.markUnhealthy(result, `${this.name}: Telegram rejects the bot token. Check the token in .env.`);
      return result;
    }
    if (observation.pm2Status && !['online', 'launching'].includes(observation.pm2Status)) {
      this.markUnhealthy(result, `${this.name}: PM2 reports the process is ${observation.pm2Status}. Restarting.`);
      result.restart = this.canRestart(now);
      if (result.restart) this.lastRestartAt = now;
      return result;
    }

    const pending = observation.pending ?? 0;
    if (pending > 0 && pending >= this.lastPending) {
      this.stuckCount += 1;
    } else {
      this.stuckCount = 0;
    }
    this.lastPending = pending;

    if (this.stuckCount >= this.stuckChecks) {
      if (this.canRestart(now)) {
        // Every restart is worth a message, including a repeat after the cooldown.
        result.alerts.push(`${this.name}: ${pending} updates queued and nothing draining them for ${this.stuckCount} checks. Restarting.`);
        this.unhealthy = true;
        result.restart = true;
        this.lastRestartAt = now;
        this.stuckCount = 0;
      } else if (!this.unhealthy) {
        this.markUnhealthy(result, `${this.name}: still not draining updates after a restart (${pending} queued).`);
      }
      return result;
    }

    if (this.unhealthy && pending === 0) {
      this.unhealthy = false;
      result.recovered = true;
      result.alerts.push(`${this.name}: recovered, queue is empty.`);
    }
    return result;
  }

  canRestart(now) {
    return this.lastRestartAt === null || now - this.lastRestartAt >= this.cooldownMs;
  }

  markUnhealthy(result, message) {
    if (!this.unhealthy) result.alerts.push(message);
    this.unhealthy = true;
  }
}

/** Sends alerts through a bot token to one chat, de-duplicating repeats. */
export class Alerter {
  constructor({ token, chatId, repeatSeconds = MONITOR_DEFAULTS.alert_repeat_seconds, fetchImpl = fetch, log = console }) {
    this.token = token;
    this.chatId = chatId;
    this.repeatMs = repeatSeconds * 1000;
    this.fetchImpl = fetchImpl;
    this.log = log;
    this.lastSent = new Map();
  }

  get enabled() {
    return Boolean(this.token && this.chatId);
  }

  async send(message, now = Date.now()) {
    const last = this.lastSent.get(message);
    if (last !== undefined && now - last < this.repeatMs) return false;
    this.lastSent.set(message, now);
    this.log.warn(`ALERT ${message}`);
    if (!this.enabled) return false;
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.chatId, text: `cardbot-monitor: ${message}` }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) this.log.warn(`alert delivery failed: HTTP ${res.status}`);
      return res.ok;
    } catch (err) {
      this.log.warn(`alert delivery failed: ${err.message}`);
      return false;
    }
  }
}

/** One Telegram observation for a bot: token validity and queued updates. */
export async function observeTelegram(token, fetchImpl = fetch) {
  try {
    const info = await telegramGet(token, 'getWebhookInfo', fetchImpl);
    if (info.ok) return { tokenOk: true, pending: info.result.pending_update_count || 0 };
    if (info.error_code === 401) return { tokenOk: false };
    return { apiError: `${info.error_code} ${info.description}` };
  } catch (err) {
    return { apiError: err.message };
  }
}

async function telegramGet(token, method, fetchImpl) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(15_000) });
  return res.json();
}

/** PM2 helpers. The pm2 binary is looked up next to the running node first. */
export function pm2Binary() {
  return path.join(path.dirname(process.execPath), 'pm2');
}

export async function pm2Statuses(exec = execFileAsync) {
  try {
    const { stdout } = await exec(pm2Binary(), ['jlist'], { maxBuffer: 8 * 1024 * 1024 });
    const jsonStart = stdout.indexOf('[');
    const list = JSON.parse(stdout.slice(jsonStart));
    return Object.fromEntries(list.map((p) => [p.name, p.pm2_env?.status || 'unknown']));
  } catch {
    return {};
  }
}

export async function pm2Restart(name, exec = execFileAsync) {
  await exec(pm2Binary(), ['restart', name]);
}
