/**
 * Configuration validator for Rainbow AI
 *
 * Validates all required keys in settings.json, workflows.json, and routing.json
 * on server startup. Fails fast with clear error messages if configuration is
 * incomplete or malformed.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import {
  settingsDataSchema,
  workflowsDataSchema,
  routingDataSchema,
} from '../assistant/schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Custom error class for configuration validation failures
 */
export class ConfigValidationError extends Error {
  constructor(
    public filePath: string,
    public details: string,
    message?: string
  ) {
    super(message || `Configuration validation failed: ${details}`);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Loads and parses a JSON file with error handling
 */
function loadJsonFile(filePath: string): unknown {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigValidationError(
        filePath,
        `Invalid JSON: ${error.message}`,
        `Failed to parse ${filePath}: ${error.message}`
      );
    }
    throw new ConfigValidationError(
      filePath,
      `Failed to read file: ${(error as Error).message}`,
      `Could not read ${filePath}: ${(error as Error).message}`
    );
  }
}

/**
 * Formats Zod validation errors to include key names and file path
 */
function formatValidationError(
  filePath: string,
  error: z.ZodError
): string {
  const issues = error.issues.slice(0, 5); // Limit to first 5 issues
  const formattedIssues = issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `  - Missing or invalid key: ${path} — ${issue.message}`;
    })
    .join('\n');

  return `${filePath}\n${formattedIssues}${
    error.issues.length > 5 ? `\n  ... and ${error.issues.length - 5} more` : ''
  }`;
}

/**
 * Validates settings.json
 */
function validateSettings(
  filePath: string
): { valid: true; count: number } | { valid: false; error: ConfigValidationError } {
  try {
    const data = loadJsonFile(filePath);
    const result = settingsDataSchema.safeParse(data);

    if (!result.success) {
      const error = new ConfigValidationError(
        filePath,
        `Invalid settings structure: ${formatValidationError(filePath, result.error)}`,
        `Settings validation failed`
      );
      return { valid: false, error };
    }

    // Count top-level keys to verify coverage
    const settings = result.data as Record<string, unknown>;
    const requiredKeys = [
      'ai',
      'system_prompt',
      'rate_limits',
      'staff',
    ];

    const missingKeys = requiredKeys.filter(key => !(key in settings));
    if (missingKeys.length > 0) {
      const error = new ConfigValidationError(
        filePath,
        `Missing required keys: ${missingKeys.join(', ')}`,
        `Settings missing required configuration`
      );
      return { valid: false, error };
    }

    return { valid: true, count: Object.keys(settings).length };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return { valid: false, error };
    }
    const err = new ConfigValidationError(
      filePath,
      (error as Error).message,
      `Unexpected error validating settings`
    );
    return { valid: false, error: err };
  }
}

/**
 * Validates workflows.json
 */
function validateWorkflows(
  filePath: string
): { valid: true; count: number } | { valid: false; error: ConfigValidationError } {
  try {
    const data = loadJsonFile(filePath);
    const result = workflowsDataSchema.safeParse(data);

    if (!result.success) {
      const error = new ConfigValidationError(
        filePath,
        `Invalid workflows structure: ${formatValidationError(filePath, result.error)}`,
        `Workflows validation failed`
      );
      return { valid: false, error };
    }

    // Validate each workflow has required fields
    const workflows = result.data.workflows || [];
    for (const workflow of workflows) {
      if (!workflow.id) {
        const error = new ConfigValidationError(
          filePath,
          `Workflow missing required field 'id'`,
          `Workflows validation failed`
        );
        return { valid: false, error };
      }
      if (!workflow.name) {
        const error = new ConfigValidationError(
          filePath,
          `Workflow '${workflow.id}' missing required field 'name'`,
          `Workflows validation failed`
        );
        return { valid: false, error };
      }

      // Validate each step has required fields (id and message at minimum)
      if (workflow.steps && Array.isArray(workflow.steps)) {
        for (let i = 0; i < workflow.steps.length; i++) {
          const step = workflow.steps[i];
          if (!step.id) {
            const error = new ConfigValidationError(
              filePath,
              `Workflow '${workflow.id}' step ${i} missing required field 'id'`,
              `Workflows validation failed`
            );
            return { valid: false, error };
          }
          if (!step.message) {
            const error = new ConfigValidationError(
              filePath,
              `Workflow '${workflow.id}' step '${step.id}' missing required field 'message'`,
              `Workflows validation failed`
            );
            return { valid: false, error };
          }
        }
      }
    }

    return { valid: true, count: workflows.length };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return { valid: false, error };
    }
    const err = new ConfigValidationError(
      filePath,
      (error as Error).message,
      `Unexpected error validating workflows`
    );
    return { valid: false, error: err };
  }
}

/**
 * Validates routing.json
 */
function validateRouting(
  filePath: string
): { valid: true; count: number } | { valid: false; error: ConfigValidationError } {
  try {
    const data = loadJsonFile(filePath);
    const result = routingDataSchema.safeParse(data);

    if (!result.success) {
      const error = new ConfigValidationError(
        filePath,
        `Invalid routing structure: ${formatValidationError(filePath, result.error)}`,
        `Routing validation failed`
      );
      return { valid: false, error };
    }

    // Validate each route has required action field
    const routing = result.data || {};
    for (const [intentId, route] of Object.entries(routing)) {
      if (!route.action) {
        const error = new ConfigValidationError(
          filePath,
          `Intent '${intentId}' missing required field 'action'`,
          `Routing validation failed`
        );
        return { valid: false, error };
      }
      if (route.action === 'workflow' && !route.workflow_id) {
        const error = new ConfigValidationError(
          filePath,
          `Intent '${intentId}' has action='workflow' but missing 'workflow_id'`,
          `Routing validation failed`
        );
        return { valid: false, error };
      }
    }

    return { valid: true, count: Object.keys(routing).length };
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return { valid: false, error };
    }
    const err = new ConfigValidationError(
      filePath,
      (error as Error).message,
      `Unexpected error validating routing`
    );
    return { valid: false, error: err };
  }
}

/**
 * Main validation function - validates all config files
 * Throws ConfigValidationError if any validation fails
 * Logs validation summary to console and logger on success
 */
export async function validateAll(): Promise<void> {
  const dataDir = join(__dirname, '..', 'assistant', 'data');

  const settingsPath = join(dataDir, 'settings.json');
  const workflowsPath = join(dataDir, 'workflows.json');
  const routingPath = join(dataDir, 'routing.json');

  // Validate all config files
  const settingsResult = validateSettings(settingsPath);
  if (!settingsResult.valid) {
    throw settingsResult.error;
  }

  const workflowsResult = validateWorkflows(workflowsPath);
  if (!workflowsResult.valid) {
    throw workflowsResult.error;
  }

  const routingResult = validateRouting(routingPath);
  if (!routingResult.valid) {
    throw routingResult.error;
  }

  // Log validation summary
  const summary = `Config: ${settingsResult.count}/${settingsResult.count} settings valid, ${workflowsResult.count}/${workflowsResult.count} workflows valid, ${routingResult.count} routes valid`;
  console.log(`✓ ${summary}`);
}
