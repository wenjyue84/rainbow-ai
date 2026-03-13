module.exports = {
  apps: [
    {
      name: 'rainbow-ai',
      script: 'dist/index.js',
      cwd: '/var/www/rainbow-ai',
      node_args: '--max-old-space-size=450',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        MCP_SERVER_PORT: 3002,
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/var/www/rainbow-ai/logs/rainbow-ai-error.log',
      out_file: '/var/www/rainbow-ai/logs/rainbow-ai-out.log',
      merge_logs: true,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 12000, // Allow 10 s graceful drain + 2 s buffer (US-437)
    },
  ],
};
