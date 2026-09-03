# cardbot

A Telegram bot that serves trading-card images on demand. Type `/p` in a chat
and get a random card; type `/p PEPEBRAIN` and get that card. One codebase runs
any number of bots for any number of collections: each bot is a small JSON
config that says which command to answer, where the cards come from, and what
to say under the image.

It started life as four near-identical PHP bots (PepeCardBot, RareDogeBot,
RareRejectBot, KingKetBot) and was rewritten so anyone with a folder of images
and a bot token can run their own.

## Quick start

```bash
git clone https://github.com/jdogresorg/cardbot.git
cd cardbot
npm install
cp .env.example .env        # paste your token from @BotFather
mkdir cards                 # drop images in here: PEPEBRAIN.png, LOOTDOGE.gif, ...
node bin/cardbot.js configs/example-folder.json --check   # loads cards, verifies the token
node bin/cardbot.js configs/example-folder.json           # runs the bot
```

Add the bot to a group and type `/card`. Telegram only delivers commands to
bots in groups (privacy mode), which is all this bot needs.

## Config reference

One JSON file per bot. Relative paths resolve against the config file's
directory.

```json
{
  "name": "MyCardBot",
  "token_env": "MYCARDBOT_TOKEN",
  "commands": ["card", "c"],
  "source": { "type": "folder", "path": "../cards" },
  "reply": { "text": "{name}", "only_when_random": true },
  "gif_as": "animation",
  "exclude": [],
  "suggestions": 10,
  "refresh_minutes": 60,
  "ignore_older_than_seconds": 120,
  "cache_dir": "./cache"
}
```

| Key | Meaning |
|---|---|
| `name` | Display name, used in logs and as the cache file name. |
| `token_env` | Environment variable holding the bot token. Tokens never go in config files. |
| `commands` | Command aliases, matched case-insensitively, with or without `@BotName`. |
| `help` | Optional override for the `/help` text (Markdown). |
| `source` | Where cards come from. See below. |
| `reply.text` | Template sent as a message after the image. Fields: `{name}` plus anything the source provides (`{title}`, `{series}`, `{card}`, `{url}`). |
| `reply.only_when_random` | If true, the text is only sent when the user asked for a random card. |
| `gif_as` | `document` sends GIFs as files (original bytes); `animation` sends them as inline animations. |
| `exclude` | Card names never served, even at random. |
| `suggestions` | Max "did you mean" suggestions on a miss. |
| `refresh_minutes` | How often to reload the source. `0` disables. |
| `ignore_older_than_seconds` | Skip messages older than this after a restart so a backlog is not replayed. |
| `cache_dir` | Where Telegram `file_id`s are remembered so each image uploads once. |

### Sources

**folder**: a directory of images. The card name is the file name without its
extension, upper-cased. Optional `manifest` is a JSON map of name to file name;
when present only listed cards are served.

```json
{ "type": "folder", "path": "/srv/cards", "manifest": "/srv/cards.json" }
```

**list**: a JSON document (URL or file) that lists the cards, plus an optional
`images` base (local folder or URL prefix). Accepted shapes:

```json
[ { "asset": "LOOTDOGE", "image": "LOOTDOGE.png" } ]
{ "data": [ { "asset": "LOOTDOGE", "image": "LOOTDOGE.png" } ] }
{ "LOOTDOGE": "https://example.com/images/LOOTDOGE.png" }
```

When the list carries full image URLs and `images` is a local folder, the bot
serves the local file with the same basename (fast path for running next to
the site). Without `images` it hands Telegram the URL.

```json
{ "type": "list", "list": "https://example.com/list.json",
  "images": "/srv/example.com/images/cards" }
```

**mysql**: the card list is the result of a SELECT against MySQL or MariaDB.
`dsn_env` names the env var holding a `mysql://user:pass@host/db` URL. The
query must return a name column (`asset` or `name`) and an image column
(`image` or `file`); extra columns become template fields. A connection is
opened per refresh and closed again, so server idle timeouts cannot strand
the bot.

```json
{ "type": "mysql", "dsn_env": "MYBOT_DB_URL",
  "query": "SELECT asset, image FROM cards WHERE status='Approved'",
  "images": "/srv/site/images/cards" }
```

Give the bot its own read-only login rather than an admin account:

```sql
CREATE USER 'cardbot'@'localhost' IDENTIFIED BY 'a-long-random-password';
GRANT SELECT ON mydb.cards TO 'cardbot'@'localhost';
```

Then in `.env`: `MYBOT_DB_URL=mysql://cardbot:a-long-random-password@127.0.0.1:3306/mydb`.

## Behaviour

- `/cmd` with no name: random card, then the reply text.
- `/cmd NAME`: exact match, or the single card whose name contains NAME.
- Several partial matches: "Card not found. Did you mean A or B?"
- GIFs go out as documents or animations per `gif_as`; everything else as a photo.
- After the first send of a card, its Telegram `file_id` is cached and reused,
  so images upload once.
- The source is reloaded every `refresh_minutes`, so new cards appear without
  a restart.
- Network errors reconnect; a bad cached `file_id` triggers a re-upload.

## Running several bots with PM2

`ecosystem.config.cjs` turns every `configs/<name>.json` into a PM2 app
called `<name>` (the `example-*.json` files are skipped), and adds the
monitor when `configs/monitor.json` exists. Tokens come from `.env` in the
repo root. Your real configs are gitignored, so a checkout only carries the
examples: copy one, rename it, and edit.

```bash
npm install -g pm2
cp configs/example-folder.json configs/mybot.json   # then edit it
pm2 start ecosystem.config.cjs            # all bots
pm2 start ecosystem.config.cjs --only mybot
pm2 save && pm2 startup                   # survive reboots
pm2 logs mybot
```

## Monitoring

PM2 restarts a bot that crashes, but a bot can be alive and deaf: Telegram
queues its updates and nobody answers. `bin/cardbot-monitor.js` watches for
exactly that. Every minute it asks Telegram how many updates each bot has
queued; a queue that stays non-empty for three checks means nothing is
polling, so the monitor restarts that bot through PM2 and sends you a
Telegram message. It also alerts on a stopped or errored PM2 process, a
rejected token, and recovery.

```bash
# 1. learn your chat id: send /help to any of your bots in a private chat
# 2. put it in .env
echo 'CARDBOT_ALERT_CHAT_ID=123456789' >> .env
# 3. copy configs/example-monitor.json to configs/monitor.json, list your bots in it
# 4. run the monitor (ecosystem.config.cjs picks it up once monitor.json exists)
pm2 start ecosystem.config.cjs --only cardbot-monitor
```

`configs/monitor.json` lists the bot configs to watch, the check interval,
how many stuck checks trigger a restart, the cooldown between restarts, and
which bot token sends alerts. Alerts go out through one of your own bots, so
no extra bot is needed. Without a chat id the monitor still restarts, and
only logs.

The ecosystem file also restarts every bot daily at 04:00 server time and
never gives up restarting a crashing bot.

## Tests

```bash
npm test
```

## License

MIT
