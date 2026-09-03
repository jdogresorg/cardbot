/**
 * MySQL / MariaDB source: the card list is the result of a SELECT.
 *
 *   {
 *     "type": "mysql",
 *     "dsn_env": "MYBOT_DB_URL",
 *     "query": "SELECT asset, image FROM cards WHERE status='Approved'",
 *     "images": "/srv/example.com/images/cards",
 *     "refresh_minutes": 60
 *   }
 *
 * `dsn_env` names the environment variable holding a connection URL such as
 * mysql://user:password@localhost:3306/dbname (kept in .env, never in the
 * config). The query must return a name column (`asset` or `name`) and an
 * image column (`image` or `file`); any other columns ride along as card
 * fields usable in reply templates. A fresh connection is opened per refresh
 * and closed afterwards, so an idle-timeout on the server can never strand
 * the bot with a dead handle.
 */
import { entriesToCards } from './list.js';

export async function loadMysqlSource(source, { log = console, connect } = {}) {
  const dsn = process.env[source.dsn_env];
  if (!dsn) throw new Error(`environment variable ${source.dsn_env} is not set (mysql:// URL for the card database)`);
  const open = connect || defaultConnect;
  const connection = await open(dsn);
  try {
    const [rows] = await connection.query(source.query);
    const cards = entriesToCards(rows, source.images, log);
    if (cards.length === 0) log.warn('[mysql] query produced no cards');
    return cards;
  } finally {
    await connection.end().catch(() => {});
  }
}

async function defaultConnect(dsn) {
  const { createConnection } = await import('mysql2/promise');
  return createConnection({ uri: dsn, connectTimeout: 10_000 });
}
