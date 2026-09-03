#!/usr/bin/env node
/**
 * cardbot-monitor <monitor.json>
 *
 * Watches a set of cardbot instances, restarts one through PM2 when it stops
 * draining its Telegram updates or its process is down, and alerts a Telegram
 * chat. See configs/monitor.json and README "Monitoring".
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { config as loadDotenv } from 'dotenv';
import { Alerter, BotWatch, MONITOR_DEFAULTS, observeTelegram, pm2Restart, pm2Statuses } from '../src/monitor.js';

const configPath = process.argv[2];
if (!configPath) {
  console.error('usage: cardbot-monitor <monitor.json>');
  process.exit(2);
}
loadDotenv({ path: process.env.CARDBOT_ENV || path.resolve(process.cwd(), '.env'), quiet: true });

const log = {
  info: (m) => console.log(`${new Date().toISOString()} ${m}`),
  warn: (m) => console.warn(`${new Date().toISOString()} WARN ${m}`),
  error: (m) => console.error(`${new Date().toISOString()} ERROR ${m}`),
};

const monitorFile = path.resolve(configPath);
const raw = JSON.parse(await readFile(monitorFile, 'utf8'));
const settings = { ...MONITOR_DEFAULTS, ...raw };
const baseDir = path.dirname(monitorFile);

const bots = [];
for (const entry of settings.bots || []) {
  const file = path.resolve(baseDir, entry);
  const botConfig = JSON.parse(await readFile(file, 'utf8'));
  const token = process.env[botConfig.token_env];
  if (!token) {
    log.warn(`${botConfig.name}: ${botConfig.token_env} not set, skipping`);
    continue;
  }
  bots.push({
    name: botConfig.name,
    pm2Name: path.basename(file, '.json'),
    token,
    watch: new BotWatch(botConfig.name, settings),
  });
}
if (bots.length === 0) {
  log.error('no bots to watch');
  process.exit(1);
}

const alertToken = settings.alert?.token_env ? process.env[settings.alert.token_env] : bots[0].token;
const alertChat = settings.alert?.chat_id_env ? process.env[settings.alert.chat_id_env] : settings.alert?.chat_id;
const alerter = new Alerter({ token: alertToken, chatId: alertChat, repeatSeconds: settings.alert_repeat_seconds, log });
if (!alerter.enabled) {
  log.warn('alerts disabled: set the alert chat id (send /help to a bot in a private chat to learn yours)');
}

log.info(`watching ${bots.map((b) => b.name).join(', ')} every ${settings.interval_seconds}s; alerts ${alerter.enabled ? 'on' : 'off'}`);
await alerter.send(`started, watching ${bots.map((b) => b.name).join(', ')}`);

async function tick() {
  const statuses = settings.pm2 ? await pm2Statuses() : {};
  for (const bot of bots) {
    const observation = await observeTelegram(bot.token);
    if (settings.pm2 && statuses[bot.pm2Name]) observation.pm2Status = statuses[bot.pm2Name];
    const decision = bot.watch.observe(observation);
    if (observation.apiError) log.warn(`${bot.name}: Telegram unreachable (${observation.apiError}), skipping`);
    for (const message of decision.alerts) await alerter.send(message);
    if (decision.restart && settings.pm2) {
      try {
        await pm2Restart(bot.pm2Name);
        log.info(`${bot.name}: pm2 restart ${bot.pm2Name} issued`);
      } catch (err) {
        await alerter.send(`${bot.name}: pm2 restart failed: ${err.message}`);
      }
    }
  }
}

await tick();
const timer = setInterval(() => tick().catch((err) => log.error(`tick failed: ${err.message}`)), settings.interval_seconds * 1000);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { clearInterval(timer); process.exit(0); });
}
