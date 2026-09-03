/**
 * Folder source: cards are image files in a directory.
 *
 *   { "type": "folder", "path": "./cards" }
 *   { "type": "folder", "path": "./cards", "manifest": "./cards.json" }
 *
 * Without a manifest the card name is the file name minus its extension,
 * upper-cased (PEPEBRAIN.png -> PEPEBRAIN). With a manifest, the JSON file
 * is a map of card name -> file name inside the folder, and only listed cards
 * are served. Either way, cards whose file is missing are skipped with a
 * warning instead of aborting startup.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { extensionOf } from '../cards.js';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);

export async function loadFolderSource(source, { log = console } = {}) {
  const dir = source.path;
  const cards = [];

  if (source.manifest) {
    const manifest = JSON.parse(await readFile(source.manifest, 'utf8'));
    for (const [name, fileName] of Object.entries(manifest)) {
      const file = path.join(dir, fileName);
      if (await exists(file)) {
        cards.push({ name, file });
      } else {
        log.warn(`[folder] missing image for ${name}: ${file}`);
      }
    }
    return cards;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extensionOf(entry.name);
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const name = entry.name.slice(0, -(ext.length + 1));
    cards.push({ name, file: path.join(dir, entry.name) });
  }
  return cards;
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}
