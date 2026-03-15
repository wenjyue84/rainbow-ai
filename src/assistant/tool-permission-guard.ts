/**
 * tool-permission-guard.ts — US-929: OWASP LLM08 Excessive Agency
 *
 * Enforces a permission matrix that restricts which tools the AI can call
 * based on the active intent class and confidence score.
 *
 * Rules:
 * 1. Each intent has an explicit whitelist of permitted tool names.
 * 2. Destructive tools (cancel_booking, send_message, submit_order) require
 *    confidence >= 0.85 before execution.
 * 3. Blocked calls return a safe fallback result (not an error) so the tool
 *    loop can continue and produce a human-friendly response.
 * 4. Every dispatch (allowed or blocked) is audit-logged.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToolCallContext {
  /** Active intent class (e.g. 'booking', 'ORDER_CONFIRM', 'checkout_now') */
  intent: string;
  /** Classification confidence 0–1 */
  confidence: number;
}

export interface PermissionCheckResult {
  allowed: boolean;
  /** Reason for denial (undefined when allowed) */
  reason?: string;
}

export interface ToolPermissions {
  _comment?: string;
  destructiveTools: string[];
  destructiveConfidenceThreshold: number;
  readOnlyTools: string[];
  intentPermissions: Record<string, { allowed: string[] }>;
}

// ─── Config loader ────────────────────────────────────────────────────────────

let _cachedPermissions: ToolPermissions | null = null;

function loadPermissions(): ToolPermissions {
  if (_cachedPermissions) return _cachedPermissions;

  // Resolve path relative to this file (works in both src/ and dist/)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const configPath = path.join(__dirname, 'data', 'tool-permissions.json');

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    _cachedPermissions = JSON.parse(raw) as ToolPermissions;
    return _cachedPermissions;
  } catch (err: any) {
    console.warn(`[ToolPermissionGuard] Failed to load tool-permissions.json: ${err.message}. Falling back to allow-all.`);
    _cachedPermissions = {
      destructiveTools: [],
      destructiveConfidenceThreshold: 0.85,
      readOnlyTools: [],
      intentPermissions: {}
    };
    return _cachedPermissions;
  }
}

/** Clear the permissions cache (used in tests to reload config). */
export function clearPermissionsCache(): void {
  _cachedPermissions = null;
}

// ─── Permission check ─────────────────────────────────────────────────────────

/**
 * Check whether a tool call is permitted given the active intent context.
 *
 * Enforcement rules (in order):
 * 1. Unknown / unconfigured intent → permit read-only tools only.
 * 2. Intent has an explicit whitelist → tool must be in the whitelist.
 * 3. Destructive tools additionally require confidence >= threshold.
 */
export function checkToolPermission(
  toolName: string,
  context: ToolCallContext
): PermissionCheckResult {
  const cfg = loadPermissions();
  const { intent, confidence } = context;

  const intentEntry = cfg.intentPermissions[intent];

  // Intent not in matrix — fall back to read-only tools only
  if (!intentEntry) {
    const isReadOnly = cfg.readOnlyTools.includes(toolName);
    if (!isReadOnly) {
      return {
        allowed: false,
        reason: `Intent '${intent}' has no permission entry; tool '${toolName}' is not in the read-only allow-list`
      };
    }
    // Still enforce destructive threshold even for read-only fallback path
    if (cfg.destructiveTools.includes(toolName) && confidence < cfg.destructiveConfidenceThreshold) {
      return {
        allowed: false,
        reason: `Destructive tool '${toolName}' requires confidence >= ${cfg.destructiveConfidenceThreshold}, got ${confidence.toFixed(2)}`
      };
    }
    return { allowed: true };
  }

  // Intent has explicit whitelist — tool must be present
  if (!intentEntry.allowed.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' is not permitted for intent '${intent}'`
    };
  }

  // Destructive tool — enforce minimum confidence
  if (cfg.destructiveTools.includes(toolName) && confidence < cfg.destructiveConfidenceThreshold) {
    return {
      allowed: false,
      reason: `Destructive tool '${toolName}' requires confidence >= ${cfg.destructiveConfidenceThreshold}, got ${confidence.toFixed(2)}. Deferring to human.`
    };
  }

  return { allowed: true };
}

// ─── Audit log ────────────────────────────────────────────────────────────────

export interface ToolDispatchAuditEntry {
  timestamp: string;
  intent: string;
  confidence: number;
  toolName: string;
  outcome: 'allowed' | 'blocked';
  reason?: string;
}

/**
 * Emit an audit log entry for a tool dispatch decision.
 * Uses console.log so it appears in PM2/CloudWatch logs.
 */
export function auditToolDispatch(
  toolName: string,
  context: ToolCallContext,
  result: PermissionCheckResult
): void {
  const entry: ToolDispatchAuditEntry = {
    timestamp: new Date().toISOString(),
    intent: context.intent,
    confidence: context.confidence,
    toolName,
    outcome: result.allowed ? 'allowed' : 'blocked',
    reason: result.reason
  };
  console.log(`[ToolPermissionAudit] ${JSON.stringify(entry)}`);
}

// ─── Safe blocked-call result ─────────────────────────────────────────────────

/**
 * Returns an MCP-compatible tool result that signals a blocked call without
 * throwing. The AI loop can still generate a helpful text response from this.
 */
export function blockedToolResult(toolName: string, reason: string) {
  return {
    content: [{
      type: 'text' as const,
      text: `Tool '${toolName}' call was blocked by the permission guard: ${reason}. Please provide a helpful response based on available context without using this tool.`
    }],
    isError: false  // not isError so the fallback path isn't triggered
  };
}
