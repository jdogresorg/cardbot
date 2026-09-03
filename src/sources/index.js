import { loadFolderSource } from './folder.js';
import { loadListSource } from './list.js';
import { loadMysqlSource } from './mysql.js';

const LOADERS = {
  folder: loadFolderSource,
  list: loadListSource,
  mysql: loadMysqlSource,
};

export const SOURCE_TYPES = Object.keys(LOADERS);

/** Load every card for a source config. Returns an array of card records. */
export async function loadSource(source, options) {
  const loader = LOADERS[source.type];
  if (!loader) throw new Error(`unknown source type "${source.type}" (expected: ${SOURCE_TYPES.join(', ')})`);
  return loader(source, options);
}
