// Resolve nvm-managed Node binary at PM2 config load time.
const nodeInterpreter = (() => {
  try {
    return require('child_process').execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
    return 'node';
  }
})();

module.exports = {
  apps: [
    {
      name: 'rainbow-ai',
      script: 'dist/index.js',
      cwd: '/opt/rainbow-ai',
      interpreter: nodeInterpreter,
      node_args: '--max-old-space-size=550',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        MCP_SERVER_PORT: 3003,
        SQLITE_PATH: '/opt/rainbow-ai/data/rainbow-ai.db',
        BUSINESS_NAME: 'makan-moments',
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: '2G',   // RSS includes ~1.3GB from native ML models (RAG cross-encoder, semantic embeddings); heap capped separately via --max-old-space-size
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/opt/rainbow-ai/logs/rainbow-ai-error.log',
      out_file: '/opt/rainbow-ai/logs/rainbow-ai-out.log',
      merge_logs: true,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 12000,
    },
  ],
};
