// US-496: Resolve nvm-managed Node 24 binary at PM2 config load time.
// deploy.sh runs `nvm use 24` before `pm2 start`, so `which node` returns the v24 path.
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
      cwd: '/var/www/rainbow-ai',
      interpreter: nodeInterpreter,
      node_args: '--max-old-space-size=450 --import ./dist/instrumentation.js',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        MCP_SERVER_PORT: 3002,
        // Meta CA cert for mTLS webhook continuity (US-478)
        // Replace deploy/certs/meta-outbound-api-ca-2025-12.pem with the real cert before 2026-04-01
        NODE_EXTRA_CA_CERTS: '/var/www/rainbow-ai/deploy/certs/meta-outbound-api-ca-2025-12.pem',
        // US-499: AWS Secrets Manager — set to 'true' to fetch secrets from SM
        // instead of .env file. Requires IAM instance profile with
        // secretsmanager:GetSecretValue permission on the target secret ARNs.
        // USE_SECRETS_MANAGER: 'true',
        // AWS_SECRET_NAME: 'rainbow-ai/prod',
        // AWS_REGION: 'ap-southeast-1',
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
      listen_timeout: 60000, // 60s — startup loads embeddings for 6 profiles (~30s)
      kill_timeout: 12000, // Allow 10 s graceful drain + 2 s buffer (US-437)
    },
  ],
};
