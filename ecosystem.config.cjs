module.exports = {
  apps: [
    {
      name: 'pepsa-admin-api',
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      kill_timeout: 15000,
      autorestart: true,
      merge_logs: true,
      time: true,
      env: { NODE_ENV: 'production', PORT: 3300 },
    },
    {
      name: 'pepsa-admin-workers',
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
