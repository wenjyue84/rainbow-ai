/**
 * ConfigAuditor — Production configuration health checks for Rainbow AI.
 *
 * Validates: DB connectivity, AI provider keys, RAINBOW_ROLE, profile directories.
 * Used by `npm run audit:config` CLI script.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import pg from 'pg';

export interface AuditWarning {
  field: string;
  message: string;
  fix_command: string;
}

export interface AuditResult {
  validation_result: 'PASS' | 'FAIL';
  total_checks: number;
  passed: number;
  failed: number;
  warnings: AuditWarning[];
  timestamp: string;
  environment: string;
}

export interface CheckResult {
  passed: boolean;
  warnings: AuditWarning[];
}

export class ConfigAuditor {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  async checkDbConnection(): Promise<CheckResult> {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return {
        passed: false,
        warnings: [
          {
            field: 'DATABASE_URL',
            message: 'DATABASE_URL is not set',
            fix_command: 'export DATABASE_URL=postgresql://user:pass@host/db?sslmode=require',
          },
        ],
      };
    }

    const client = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return { passed: true, warnings: [] };
    } catch (err) {
      await client.end().catch(() => undefined);
      return {
        passed: false,
        warnings: [
          {
            field: 'DATABASE_URL',
            message: `Database connection failed: ${(err as Error).message}`,
            fix_command: 'Check DATABASE_URL value and Neon project status',
          },
        ],
      };
    }
  }

  checkApiKeys(): CheckResult {
    // Accept any of these as valid AI provider credentials
    const providers: Array<{ key: string; label: string }> = [
      { key: 'KIMI_API_KEY', label: 'Kimi K2' },
      { key: 'MOONSHOT_API_KEY', label: 'Moonshot/Kimi' },
      { key: 'NVIDIA_API_KEY', label: 'NVIDIA NIM' },
      { key: 'OLLAMA_BASE_URL', label: 'Ollama' },
      { key: 'OPENROUTER_API_KEY', label: 'OpenRouter' },
      { key: 'OPENROUTER_KEY', label: 'OpenRouter (alt)' },
      { key: 'GEMINI_API_KEY_PELANGI', label: 'Gemini (Pelangi)' },
      { key: 'GROQ_API_KEY_PELANGI', label: 'Groq (Pelangi)' },
    ];

    const found = providers.filter((p) => !!process.env[p.key]);
    if (found.length > 0) {
      return { passed: true, warnings: [] };
    }

    return {
      passed: false,
      warnings: [
        {
          field: 'AI_PROVIDER_KEY',
          message: 'No AI provider key found. At least one is required.',
          fix_command:
            'export KIMI_API_KEY=<key> OR export OLLAMA_BASE_URL=http://localhost:11434 OR export OPENROUTER_API_KEY=<key>',
        },
      ],
    };
  }

  checkEnvVars(): CheckResult {
    const warnings: AuditWarning[] = [];

    const role = process.env.RAINBOW_ROLE;
    if (!role) {
      warnings.push({
        field: 'RAINBOW_ROLE',
        message: 'RAINBOW_ROLE is not set',
        fix_command: 'export RAINBOW_ROLE=primary  # or standby',
      });
    } else if (!['primary', 'standby'].includes(role)) {
      warnings.push({
        field: 'RAINBOW_ROLE',
        message: `RAINBOW_ROLE="${role}" is invalid; expected "primary" or "standby"`,
        fix_command: 'export RAINBOW_ROLE=primary',
      });
    }

    return { passed: warnings.length === 0, warnings };
  }

  checkDirectories(): CheckResult {
    const profileDirs = [
      {
        path: join(this.projectRoot, 'src', 'assistant', 'data', 'pelangi'),
        label: 'Pelangi profile data',
        field: 'DIR_PELANGI',
      },
      {
        path: join(this.projectRoot, 'src', 'assistant', 'data-makan'),
        label: 'Makan profile data',
        field: 'DIR_MAKAN',
      },
      {
        path: join(this.projectRoot, 'src', 'assistant', 'data-southern'),
        label: 'Southern profile data',
        field: 'DIR_SOUTHERN',
      },
    ];

    const warnings: AuditWarning[] = [];
    for (const dir of profileDirs) {
      if (!existsSync(dir.path)) {
        warnings.push({
          field: dir.field,
          message: `${dir.label} directory not found: ${dir.path}`,
          fix_command: `mkdir -p "${dir.path}"`,
        });
      }
    }

    return { passed: warnings.length === 0, warnings };
  }

  async runAll(environment: string): Promise<AuditResult> {
    const checks: CheckResult[] = [];

    // Run checks (DB is async, rest are sync)
    const dbResult = await this.checkDbConnection();
    const apiResult = this.checkApiKeys();
    const envResult = this.checkEnvVars();
    const dirResult = this.checkDirectories();

    checks.push(dbResult, apiResult, envResult, dirResult);

    const allWarnings = checks.flatMap((c) => c.warnings);
    const passed = checks.filter((c) => c.passed).length;
    const failed = checks.length - passed;

    return {
      validation_result: failed === 0 ? 'PASS' : 'FAIL',
      total_checks: checks.length,
      passed,
      failed,
      warnings: allWarnings,
      timestamp: new Date().toISOString(),
      environment,
    };
  }
}
