/**
 * Command matching, kept separate from the Telegram wiring so it can be
 * unit-tested. Matches `/p`, `/P`, `/p@BotName`, `/p PEPEBRAIN`, and trims
 * anything after the first word the way the original bots did.
 */
export function buildCommandMatcher(commands, botUsername = '') {
  const alternatives = commands.map(escapeRegExp).join('|');
  const mention = botUsername ? `(?:@${escapeRegExp(botUsername)})?` : '(?:@[A-Za-z0-9_]+)?';
  const regex = new RegExp(`^/(${alternatives})${mention}(?:\\s+(.*))?$`, 'is');
  return (text) => {
    const match = regex.exec(String(text ?? '').trim());
    if (!match) return null;
    const argument = (match[2] || '').trim();
    const [firstWord] = argument.split(/\s+/);
    return { command: match[1].toLowerCase(), argument: firstWord || '' };
  };
}

/** Text shown for /help and /start. */
export function helpText(config) {
  if (config.help) return config.help;
  const primary = `/${config.commands[0]}`;
  const aliases = config.commands.length > 1 ? ` (also ${config.commands.slice(1).map((c) => '/' + c).join(', ')})` : '';
  return [
    '```',
    `${primary}        = Display random card`,
    `${primary} [CARD] = Display specific card`,
    '```',
    aliases ? `Aliases${aliases}.` : '',
  ].filter(Boolean).join('\n');
}

/** Fill {name}, {title}, {series}, {card}, {url} and any other card field into a template. */
export function fillTemplate(template, card) {
  return String(template).replace(/\{([a-z_]+)\}/gi, (_, key) => {
    const value = card?.[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function notFoundText(suggestions) {
  if (suggestions.length === 0) return 'Card not found.';
  return `Card not found. Did you mean ${suggestions.join(' or ')}?`;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
