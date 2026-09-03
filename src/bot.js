/**
 * Telegram wiring: turns a validated config into a running grammY bot.
 */
import path from 'node:path';
import { Bot, GrammyError, InputFile } from 'grammy';
import { CardIndex, extensionOf } from './cards.js';
import { buildCommandMatcher, fillTemplate, helpText, notFoundText } from './commands.js';
import { FileIdCache } from './filecache.js';
import { loadSource } from './sources/index.js';

export async function createBot(config, { log = console } = {}) {
  const index = new CardIndex([], { exclude: config.exclude });
  const cache = await new FileIdCache(path.join(config.cache_dir, `${slug(config.name)}.file-ids.json`)).load();

  async function refresh() {
    const cards = await loadSource(config.source, { log });
    index.replace(cards);
    log.info(`[${config.name}] loaded ${index.size} cards from ${config.source.type} source`);
  }
  await refresh();
  if (index.size === 0) throw new Error(`${config.name}: source produced no cards, refusing to start`);

  const bot = new Bot(config.token);
  await bot.init();
  const match = buildCommandMatcher(config.commands, bot.botInfo.username);

  bot.catch((err) => {
    log.error(`[${config.name}] update ${err.ctx?.update?.update_id}: ${err.error?.message || err.error}`);
  });

  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    const age = Math.floor(Date.now() / 1000) - ctx.message.date;
    if (config.ignore_older_than_seconds > 0 && age > config.ignore_older_than_seconds) return;

    if (/^\/(help|start)(@\w+)?$/i.test(text.trim())) {
      let help = helpText(config);
      if (ctx.chat.type === 'private') help += `\nThis chat's id is \`${ctx.chat.id}\` (for cardbot-monitor alerts).`;
      await ctx.reply(help, { parse_mode: 'Markdown' });
      return;
    }
    const hit = match(text);
    if (!hit) return next();
    await sendCard(ctx, hit.argument);
  });

  async function sendCard(ctx, argument) {
    const { card, random, suggestions } = index.resolve(argument, config.suggestions);
    if (!card) {
      await ctx.reply(notFoundText(suggestions));
      return;
    }
    await sendImage(ctx, card);
    if (config.reply?.text && (random || !config.reply.only_when_random)) {
      await ctx.reply(fillTemplate(config.reply.text, card), { disable_web_page_preview: true });
    }
  }

  async function sendImage(ctx, card) {
    const ext = extensionOf(card.file || card.url);
    const kind = ext === 'gif' ? config.gif_as : 'photo';
    const cached = cache.get(card.name, kind);
    if (cached) {
      try {
        await send(ctx, kind, cached);
        return;
      } catch (err) {
        if (!(err instanceof GrammyError)) throw err;
        log.warn(`[${config.name}] cached file_id for ${card.name} rejected, re-uploading`);
        cache.delete(card.name, kind);
      }
    }
    const input = card.file ? new InputFile(card.file) : card.url;
    const sent = await send(ctx, kind, input);
    const fileId = extractFileId(sent, kind);
    if (fileId) {
      cache.set(card.name, kind, fileId);
      await cache.save();
    }
  }

  async function send(ctx, kind, media) {
    if (kind === 'photo') return ctx.replyWithPhoto(media);
    if (kind === 'animation') return ctx.replyWithAnimation(media);
    return ctx.replyWithDocument(media);
  }

  const timer = config.refresh_minutes > 0
    ? setInterval(() => refresh().catch((err) => log.warn(`[${config.name}] refresh failed: ${err.message}`)), config.refresh_minutes * 60_000)
    : null;
  timer?.unref?.();

  return {
    bot,
    index,
    refresh,
    async start() {
      await bot.api.setMyCommands([
        ...config.commands.map((command) => ({ command, description: 'Show a card (random if no name given)' })),
        { command: 'help', description: 'How to use this bot' },
      ]).catch((err) => log.warn(`[${config.name}] setMyCommands failed: ${err.message}`));
      log.info(`[${config.name}] polling as @${bot.botInfo.username}, commands: ${config.commands.map((c) => '/' + c).join(' ')}`);
      await bot.start({
        allowed_updates: ['message'],
        onStart: () => log.info(`[${config.name}] started`),
      });
    },
    async stop() {
      if (timer) clearInterval(timer);
      await bot.stop();
      await cache.save();
    },
  };
}

function extractFileId(message, kind) {
  if (!message) return null;
  if (kind === 'photo') {
    const sizes = message.photo || [];
    return sizes.length ? sizes[sizes.length - 1].file_id : null;
  }
  if (kind === 'animation') return message.animation?.file_id || message.document?.file_id || null;
  return message.document?.file_id || null;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
