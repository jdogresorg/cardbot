/**
 * In-memory card index: exact lookup, random pick, and substring suggestions.
 * Pure logic, no I/O, so it is easy to test.
 *
 * A card record looks like:
 *   { name: 'PEPEBRAIN', file: '/abs/path/PEPEBRAIN.png' }           (local file)
 *   { name: 'LOOTDOGE',  url: 'https://host/content/images/LOOTDOGE.png' } (remote)
 * plus any extra fields the source provides (title, description, series, card).
 */
export class CardIndex {
  constructor(cards = [], { exclude = [] } = {}) {
    this.exclude = new Set(exclude.map(normalizeName));
    this.replace(cards);
  }

  /** Replace the whole index (used on refresh). */
  replace(cards) {
    this.cards = new Map();
    for (const card of cards) {
      const name = normalizeName(card.name);
      if (!name || this.exclude.has(name)) continue;
      this.cards.set(name, { ...card, name });
    }
    this.names = [...this.cards.keys()].sort();
  }

  get size() {
    return this.cards.size;
  }

  has(name) {
    return this.cards.has(normalizeName(name));
  }

  get(name) {
    return this.cards.get(normalizeName(name)) || null;
  }

  random() {
    if (this.names.length === 0) return null;
    const name = this.names[Math.floor(Math.random() * this.names.length)];
    return this.cards.get(name);
  }

  /** Cards whose name contains the text, alphabetical, capped at limit. */
  suggest(text, limit = 10) {
    const needle = normalizeName(text);
    if (!needle) return [];
    const out = [];
    for (const name of this.names) {
      if (name.includes(needle)) {
        out.push(name);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /**
   * Resolve free text the way the original bots did:
   *   empty        -> random card
   *   exact name   -> that card
   *   one partial  -> the single matching card
   *   otherwise    -> not found, with up to `limit` suggestions
   */
  resolve(text, limit = 10) {
    const query = normalizeName(text);
    if (!query) {
      const card = this.random();
      return { card, random: true, suggestions: [] };
    }
    const exact = this.get(query);
    if (exact) return { card: exact, random: false, suggestions: [] };
    const suggestions = this.suggest(query, limit);
    if (suggestions.length === 1) {
      return { card: this.get(suggestions[0]), random: false, suggestions: [] };
    }
    return { card: null, random: false, suggestions };
  }
}

/** Card names are case-insensitive and never contain whitespace. */
export function normalizeName(text) {
  return String(text ?? '').trim().split(/\s+/)[0].toUpperCase();
}

/** Lower-cased file extension without the dot, or '' when there is none. */
export function extensionOf(pathOrUrl) {
  const clean = String(pathOrUrl).split(/[?#]/)[0];
  const idx = clean.lastIndexOf('.');
  if (idx < 0 || idx < clean.lastIndexOf('/')) return '';
  return clean.slice(idx + 1).toLowerCase();
}
