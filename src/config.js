/**
 * Load and validate a bot config file.
 *
 * Relative paths inside the config resolve against the config file's own
 * directory, so a repo can ship `configs/*.json` that point at `../cards`.
 * The bot token is never stored in the config: `token_env` names the
 * environment variable that holds it (loaded from `.env` by bin/cardbot.js).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_TYPES } from './sources/index.js';

export const DEFAULTS = {
  suggestions: 10,
  refresh_minutes: 60,
  ignore_older_than_seconds: 120,
  gif_as: 'document',
  cache_dir: './cache',
  exclude: [],
  reply: { text: '{name}', only_when_random: true },
};

export async function loadConfig(configPath) {
  const file = path.resolve(configPath);
  const raw = JSON.parse(await readFile(file, 'utf8'));
  return validateConfig(raw, path.dirname(file));
}

export function validateConfig(raw, baseDir = process.cwd()) {
  const config = { ...DEFAULTS, ...raw, reply: { ...DEFAULTS.reply, ...(raw.reply || {}) } };

  if (!config.name) throw new Error('config.name is required');
  if (!config.token_env) throw new Error('config.token_env is required (the env var holding the bot token)');
  if (!Array.isArray(config.commands) || config.commands.length === 0) {
    throw new Error('config.commands must be a non-empty array, e.g. ["p"]');
  }
  config.commands = config.commands.map((c) => String(c).replace(/^\//, '').toLowerCase());
  for (const command of config.commands) {
    if (!/^[a-z0-9_]{1,32}$/.test(command)) throw new Error(`invalid command "${command}"`);
  }

  if (!config.source || !SOURCE_TYPES.includes(config.source.type)) {
    throw new Error(`config.source.type must be one of: ${SOURCE_TYPES.join(', ')}`);
  }
  const source = { ...config.source };
  if (source.type === 'folder') {
    if (!source.path) throw new Error('folder source needs "path"');
    source.path = resolveFrom(baseDir, source.path);
    if (source.manifest) source.manifest = resolveFrom(baseDir, source.manifest);
  } else if (source.type === 'list') {
    if (!source.list) throw new Error('list source needs "list" (URL or file)');
    if (!isUrl(source.list)) source.list = resolveFrom(baseDir, source.list);
    if (source.images && !isUrl(source.images)) source.images = resolveFrom(baseDir, source.images);
  } else if (source.type === 'mysql') {
    if (!source.dsn_env) throw new Error('mysql source needs "dsn_env" (env var holding a mysql:// URL)');
    if (!source.query) throw new Error('mysql source needs "query" (SELECT returning asset/name and image columns)');
    if (source.images && !isUrl(source.images)) source.images = resolveFrom(baseDir, source.images);
  }
  config.source = source;

  if (!['document', 'animation'].includes(config.gif_as)) {
    throw new Error('config.gif_as must be "document" or "animation"');
  }
  config.cache_dir = resolveFrom(baseDir, config.cache_dir);
  config.exclude = (config.exclude || []).map((n) => String(n).toUpperCase());

  const token = process.env[config.token_env];
  if (!token) throw new Error(`environment variable ${config.token_env} is not set (put it in .env)`);
  Object.defineProperty(config, 'token', { value: token, enumerable: false });

  return config;
}

function resolveFrom(baseDir, p) {
  return path.isAbsolute(p) ? p : path.resolve(baseDir, p);
}

function isUrl(value) {
  return /^https?:\/\//i.test(String(value));
}
