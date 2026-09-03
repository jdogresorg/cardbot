#!/usr/bin/env node
/**
 * cardbot <config.json>
 *
 * Starts one Telegram card bot from a config file. The bot token comes from
 * the environment variable named by the config's `token_env`, loaded from a
 * `.env` file in the current directory (or the file named by CARDBOT_ENV).
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { config as loadDotenv } from 'dotenv';
import { loadConfig } from '../src/config.js';
import { createBot } from '../src/bot.js';

const args = process.argv.slice(2);
const check = args.includes('--check');
const configPath = args.find((a) => !a.startsWith('--'));
if (!configPath) {
  console.error('usage: cardbot <config.json> [--check]');
  console.error('  --check  load the config and card source, verify the token, then exit');
  process.exit(2);
}

loadDotenv({ path: process.env.CARDBOT_ENV || path.resolve(process.cwd(), '.env'), quiet: true });

const log = {
  info: (m) => console.log(`${stamp()} ${m}`),
  warn: (m) => console.warn(`${stamp()} WARN ${m}`),
  error: (m) => console.error(`${stamp()} ERROR ${m}`),
};

try {
  const config = await loadConfig(configPath);
  const app = await createBot(config, { log });
  if (check) {
    const sample = app.index.random();
    const missing = [];
    for (const card of app.index.cards.values()) {
      if (card.file && !(await stat(card.file).catch(() => null))) missing.push(card.name);
    }
    if (missing.length) log.warn(`[${config.name}] ${missing.length} cards have no image file, e.g. ${missing.slice(0, 5).join(', ')}`);
    log.info(`[${config.name}] check ok: @${app.bot.botInfo.username}, ${app.index.size} cards, sample ${sample.name} -> ${sample.file || sample.url}`);
    process.exit(missing.length ? 1 : 0);
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      log.info(`${signal} received, stopping`);
      app.stop().finally(() => process.exit(0));
    });
  }
  await app.start();
} catch (err) {
  log.error(err.message);
  process.exit(1);
}

function stamp() {
  return new Date().toISOString();
}
