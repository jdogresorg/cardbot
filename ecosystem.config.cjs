// PM2 process list. Every configs/<name>.json becomes an app named <name>,
// except the example-*.json files and monitor.json. If configs/monitor.json
// exists, a cardbot-monitor app is added too. Tokens come from ./.env.
//
//   pm2 start ecosystem.config.cjs             # all bots (+ monitor)
//   pm2 start ecosystem.config.cjs --only mybot
const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, 'configs');
const names = fs.readdirSync(configDir)
  .filter((f) => f.endsWith('.json') && !f.startsWith('example-') && f !== 'monitor.json')
  .map((f) => f.slice(0, -'.json'.length))
  .sort();

const common = {
  cwd: __dirname,
  interpreter: 'node',
  autorestart: true,
  restart_delay: 5000,
  exp_backoff_restart_delay: 1000,
  max_restarts: 1000000,
  min_uptime: '30s',
  merge_logs: true,
  time: true,
};

const apps = names.map((name) => ({
  ...common,
  name,
  script: 'bin/cardbot.js',
  args: `configs/${name}.json`,
  cron_restart: '0 4 * * *',
}));

if (fs.existsSync(path.join(configDir, 'monitor.json'))) {
  apps.push({
    ...common,
    name: 'cardbot-monitor',
    script: 'bin/cardbot-monitor.js',
    args: 'configs/monitor.json',
  });
}

module.exports = { apps };
