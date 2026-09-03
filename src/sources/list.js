/**
 * List source: the card list comes from a JSON document (a URL or a local
 * file) and the images live under a base path or base URL.
 *
 *   {
 *     "type": "list",
 *     "list": "https://example.com/list.json",
 *     "images": "/srv/example.com/images/cards",
 *     "refresh_minutes": 60
 *   }
 *
 * `images` may also be a URL prefix, in which case the bot hands Telegram
 * the image URL instead of uploading a local file.
 *
 * Accepted list shapes, so a directory API and a hand-written file both work:
 *   [ { "asset": "LOOTDOGE", "image": "LOOTDOGE.png", ... }, ... ]
 *   { "data": [ ...same... ] }
 *   { "LOOTDOGE": "LOOTDOGE.png", ... }
 * Each entry needs a name (`asset` or `name`) and an image file name
 * (`image` or `file`). Extra fields are kept on the card record.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function loadListSource(source, { log = console, fetchImpl = fetch } = {}) {
  const raw = await readListDocument(source.list, fetchImpl);
  const cards = entriesToCards(normalizeEntries(raw), source.images, log);
  if (cards.length === 0) log.warn(`[list] ${source.list} produced no cards`);
  return cards;
}

/**
 * Turn list entries ({asset|name, image|file, ...extra}) into card records
 * with a resolved `file` or `url`. Shared by the list and mysql sources.
 */
export function entriesToCards(entries, images, log = console) {
  const cards = [];
  for (const entry of entries) {
    const name = entry.asset || entry.name;
    const image = entry.image || entry.file;
    if (!name || !image) continue;
    const card = { ...entry, name, title: entry.name && entry.name !== name ? entry.name : undefined };
    delete card.asset;
    delete card.image;
    delete card.file;
    const located = locateImage(image, images);
    if (!located) {
      log.warn(`[list] ${name}: image "${image}" has no base folder or URL to resolve against`);
      continue;
    }
    Object.assign(card, located);
    cards.push(card);
  }
  return cards;
}

/**
 * Decide where an image lives. The list may carry a bare file name or a full
 * URL; `images` may be a local folder, a URL prefix, or absent.
 *   file name + folder  -> local file
 *   file name + prefix  -> prefix/file
 *   full URL  + folder  -> local file named after the URL's basename
 *   full URL  + prefix  -> the URL itself (the list is authoritative)
 *   full URL  + nothing -> the URL itself
 */
export function locateImage(image, images) {
  if (isUrl(image)) {
    if (images && !isUrl(images)) return { file: path.join(images, basenameOfUrl(image)) };
    return { url: image };
  }
  if (!images) return null;
  return isUrl(images) ? { url: joinUrl(images, image) } : { file: path.join(images, image) };
}

function basenameOfUrl(url) {
  const clean = url.split(/[?#]/)[0];
  return decodeURIComponent(clean.slice(clean.lastIndexOf('/') + 1));
}

async function readListDocument(location, fetchImpl) {
  if (isUrl(location)) {
    const res = await fetchImpl(location, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`list fetch failed: ${res.status} ${location}`);
    return res.json();
  }
  return JSON.parse(await readFile(location, 'utf8'));
}

export function normalizeEntries(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && typeof raw === 'object') {
    return Object.entries(raw).map(([asset, image]) =>
      typeof image === 'string' ? { asset, image } : { asset, ...image },
    );
  }
  throw new Error('list document is not an array, {data:[]}, or a name->file map');
}

export function isUrl(value) {
  return /^https?:\/\//i.test(String(value));
}

function joinUrl(base, file) {
  return base.replace(/\/+$/, '') + '/' + encodeURIComponent(file);
}
