const processSuffix = process.env.PEPSA_PM2_ENV === 'staging' ? '-staging' : '';
const port = Number(process.env.PORT || (process.env.PEPSA_PM2_ENV === 'staging' ? 3301 : 3300));

module.exports = {
  apps: [
    {
      name: `pepsa-admin-api${processSuffix}`,
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      autorestart: true,
      merge_logs: true,
      time: true,
      env: { NODE_ENV: 'production', PORT: port },
    },
    {
      name: `pepsa-admin-workers${processSuffix}`,
      script: 'dist/worker.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      autorestart: true,
      merge_logs: true,
      time: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
