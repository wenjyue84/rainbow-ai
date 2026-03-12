import axios from 'axios';
import { pool } from './db.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('integration-validator');

export interface ValidationResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

export interface SystemInfo {
  nodeVersion: string;
  memoryUsage: {
    rss: string;
    heapUsed: string;
    heapTotal: string;
  };
  uptimeSeconds: number;
  env: Record<string, string>;
}

function redactSensitive(key: string, value: string | undefined): string {
  if (!value) return '(not set)';
  const lowerKey = key.toLowerCase();
  // Show full value for URLs
  if (lowerKey.includes('url') || lowerKey.includes('host')) return value;
  // Redact tokens/keys/secrets: first 4 + last 4 chars
  if (lowerKey.includes('token') || lowerKey.includes('key') || lowerKey.includes('secret') || lowerKey.includes('password')) {
    if (value.length <= 8) return '****';
    return value.slice(0, 4) + '...' + value.slice(-4);
  }
  return value;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildFixMessage(err: any, url: string): string {
  const code = err.code || '';
  if (code === 'ECONNREFUSED') {
    return `PMS server is not running at ${url}. 1) Check if PMS is running 2) Verify DIGIMAN_API_URL in .env 3) Check firewall rules`;
  }
  if (code === 'ENOTFOUND') {
    return 'Cannot resolve hostname. Check DIGIMAN_API_URL spelling and DNS';
  }
  if (code === 'ETIMEDOUT' || code === 'ETIME') {
    return 'Connection timed out. Check firewall rules and network connectivity';
  }
  const status = err.response?.status;
  if (status === 401) {
    return 'API token is invalid or expired. Update DIGIMAN_API_TOKEN in .env';
  }
  return `Unexpected error: ${err.message || code}`;
}

async function checkDigimanUrl(): Promise<ValidationResult> {
  const url = process.env.DIGIMAN_API_URL;
  if (!url) {
    return {
      name: 'DIGIMAN_API_URL',
      status: 'error',
      message: 'Environment variable not set',
      fix: '1) Add DIGIMAN_API_URL to your .env file 2) Set it to the PMS server URL (e.g. http://localhost:3000)',
    };
  }
  try {
    new URL(url);
  } catch {
    return {
      name: 'DIGIMAN_API_URL',
      status: 'error',
      message: `Invalid URL format: ${url}`,
      fix: '1) Check the DIGIMAN_API_URL value in .env 2) Ensure it starts with http:// or https://',
    };
  }

  // Try HTTP connectivity
  try {
    try {
      await axios.get(`${url}/api/health`, { timeout: 5000 });
    } catch (healthErr: any) {
      // Fall back to /api/occupancy if /api/health doesn't exist (404)
      if (healthErr.response?.status === 404) {
        await axios.get(`${url}/api/occupancy`, { timeout: 5000 });
      } else {
        throw healthErr;
      }
    }
    return {
      name: 'DIGIMAN_API_URL',
      status: 'ok',
      message: `Reachable at ${url}`,
    };
  } catch (err: any) {
    // 401 means the server is reachable but token is bad - that's a warning here
    if (err.response?.status === 401) {
      return {
        name: 'DIGIMAN_API_URL',
        status: 'warning',
        message: `Server reachable at ${url} but returned 401 (check API token)`,
      };
    }
    return {
      name: 'DIGIMAN_API_URL',
      status: 'error',
      message: `Cannot reach PMS at ${url}: ${err.code || err.message}`,
      fix: buildFixMessage(err, url),
    };
  }
}

function checkDigimanToken(): ValidationResult {
  const token = process.env.DIGIMAN_API_TOKEN;
  if (!token) {
    return {
      name: 'DIGIMAN_API_TOKEN',
      status: 'error',
      message: 'Environment variable not set',
      fix: '1) Add DIGIMAN_API_TOKEN to your .env file 2) Copy the token from PMS settings',
    };
  }
  if (token.trim().length === 0) {
    return {
      name: 'DIGIMAN_API_TOKEN',
      status: 'error',
      message: 'Token is empty (whitespace only)',
      fix: '1) Update DIGIMAN_API_TOKEN in .env with a valid token 2) Restart the server',
    };
  }
  return {
    name: 'DIGIMAN_API_TOKEN',
    status: 'ok',
    message: 'Token is set',
  };
}

async function checkDatabase(): Promise<ValidationResult> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      name: 'DATABASE_URL',
      status: 'error',
      message: 'Environment variable not set',
      fix: '1) Add DATABASE_URL to your .env file 2) Use a Neon PostgreSQL connection string',
    };
  }

  try {
    await pool.query('SELECT 1');
    return {
      name: 'DATABASE_URL',
      status: 'ok',
      message: 'Database connection successful',
    };
  } catch (err: any) {
    const code = err.code || '';
    let fix = `Database connection failed: ${err.message}`;
    if (code === 'ECONNREFUSED') {
      fix = '1) Check if PostgreSQL is running 2) Verify DATABASE_URL in .env 3) Check firewall rules';
    } else if (code === 'ENOTFOUND') {
      fix = '1) Check the hostname in DATABASE_URL 2) Verify DNS resolution';
    } else if (code === '28P01') {
      fix = '1) Check username and password in DATABASE_URL 2) Verify database credentials';
    }
    return {
      name: 'DATABASE_URL',
      status: 'error',
      message: `Connection failed: ${err.message}`,
      fix,
    };
  }
}

export async function validateIntegrations(): Promise<ValidationResult[]> {
  const results = await Promise.all([
    checkDigimanUrl(),
    Promise.resolve(checkDigimanToken()),
    checkDatabase(),
  ]);
  return results;
}

export function getSystemInfo(): SystemInfo {
  const mem = process.memoryUsage();
  const envKeys = [
    'DIGIMAN_API_URL', 'DIGIMAN_API_TOKEN',
    'DATABASE_URL', 'NODE_ENV', 'MCP_SERVER_PORT',
    'RAINBOW_ROLE', 'RAINBOW_PEER_URL', 'RAINBOW_FAILOVER_SECRET',
    'RAINBOW_ADMIN_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY',
  ];

  const env: Record<string, string> = {};
  for (const key of envKeys) {
    env[key] = redactSensitive(key, process.env[key]);
  }

  return {
    nodeVersion: process.version,
    memoryUsage: {
      rss: formatBytes(mem.rss),
      heapUsed: formatBytes(mem.heapUsed),
      heapTotal: formatBytes(mem.heapTotal),
    },
    uptimeSeconds: Math.round(process.uptime()),
    env,
  };
}
