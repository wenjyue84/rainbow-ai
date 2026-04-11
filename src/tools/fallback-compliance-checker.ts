/**
 * US-461: Fallback Response Compliance Checker
 *
 * Validates all fallback responses in knowledge.json against business rules
 * defined in business-rules.json. Detects unauthorized promises, missing
 * contact info, inappropriate tone, and competitor mentions.
 *
 * CLI: src/tools/fallback-compliance-checker-cli.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'assistant', 'data');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BusinessRule {
  rule_id: string;
  applies_to: string[]; // list of intent IDs, or ['all']
  check: string;        // references a key in checks{}
  severity: 'critical' | 'warning';
  description: string;
}

export interface CheckDefinition {
  description: string;
  patterns?: string[];          // for "must contain" rules — fail if NONE match
  forbidden_patterns?: string[]; // for "must not contain" rules — fail if ANY match
  suggested_fix?: string;
}

export interface ProfileRules {
  rules: BusinessRule[];
}

export interface BusinessRulesConfig {
  profiles: Record<string, ProfileRules>;
  checks: Record<string, CheckDefinition>;
}

export interface KnowledgeEntry {
  intent: string;
  response: {
    en?: string;
    ms?: string;
    zh?: string;
  };
}

export interface Violation {
  response_id: string;   // e.g. "billing_dispute:en"
  response_text: string; // truncated to 120 chars
  failed_rule: string;   // rule_id
  severity: 'critical' | 'warning';
  suggested_fix: string;
  language: string;      // 'en' | 'ms' | 'zh'
}

export interface ComplianceReport {
  profile: string;
  generated_at: string;
  total_responses_checked: number;
  total_violations: number;
  critical_violations: number;
  warning_violations: number;
  violations: Violation[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export function loadBusinessRules(rulesPath?: string): BusinessRulesConfig {
  const filePath = rulesPath ?? path.join(DATA_DIR, 'business-rules.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as BusinessRulesConfig;
}

// ---------------------------------------------------------------------------
// Check logic
// ---------------------------------------------------------------------------

function truncate(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function matchesAny(text: string, patterns: string[]): boolean {
  const lower = text.toLowerCase();
  return patterns.some((p) => {
    try {
      return new RegExp(p, 'i').test(text);
    } catch {
      return lower.includes(p.toLowerCase());
    }
  });
}

function ruleAppliesToIntent(rule: BusinessRule, intent: string): boolean {
  if (rule.applies_to.includes('all')) return true;
  return rule.applies_to.includes(intent);
}

function runCheck(
  text: string,
  checkDef: CheckDefinition,
): { pass: boolean; matchedPattern?: string } {
  if (checkDef.patterns && checkDef.patterns.length > 0) {
    // "must contain" check — passes if at least one pattern matches
    const pass = matchesAny(text, checkDef.patterns);
    return { pass };
  }

  if (checkDef.forbidden_patterns && checkDef.forbidden_patterns.length > 0) {
    // "must not contain" check — passes if NO forbidden pattern matches
    for (const pat of checkDef.forbidden_patterns) {
      let matched = false;
      try {
        matched = new RegExp(pat, 'i').test(text);
      } catch {
        matched = text.toLowerCase().includes(pat.toLowerCase());
      }
      if (matched) {
        return { pass: false, matchedPattern: pat };
      }
    }
    return { pass: true };
  }

  // No patterns defined — trivially passes
  return { pass: true };
}

// ---------------------------------------------------------------------------
// Core compliance checker
// ---------------------------------------------------------------------------

/**
 * Check all knowledge entries against business rules for the given profile.
 *
 * @param profile   Profile name (e.g. 'pelangi', 'southern')
 * @param entries   Array of knowledge entries to check
 * @param config    Business rules configuration
 * @param severity  Optional filter — only include violations of this severity
 */
export function checkCompliance(
  profile: string,
  entries: KnowledgeEntry[],
  config: BusinessRulesConfig,
  severity?: 'critical' | 'warning',
): ComplianceReport {
  const profileRules = config.profiles[profile];

  // Unknown profile — return empty passing report
  if (!profileRules) {
    return {
      profile,
      generated_at: new Date().toISOString(),
      total_responses_checked: 0,
      total_violations: 0,
      critical_violations: 0,
      warning_violations: 0,
      violations: [],
      passed: true,
    };
  }

  const allViolations: Violation[] = [];
  let responsesChecked = 0;

  for (const entry of entries) {
    const langs = Object.entries(entry.response) as Array<[string, string | undefined]>;

    for (const [lang, text] of langs) {
      if (!text || !text.trim()) continue;
      responsesChecked++;
      const responseId = `${entry.intent}:${lang}`;

      for (const rule of profileRules.rules) {
        if (!ruleAppliesToIntent(rule, entry.intent)) continue;

        const checkDef = config.checks[rule.check];
        if (!checkDef) continue;

        const result = runCheck(text, checkDef);
        if (!result.pass) {
          allViolations.push({
            response_id: responseId,
            response_text: truncate(text),
            failed_rule: rule.rule_id,
            severity: rule.severity,
            suggested_fix: checkDef.suggested_fix ?? `Review response for rule: ${rule.description}`,
            language: lang,
          });
        }
      }
    }
  }

  // Filter by severity if specified
  const filteredViolations = severity
    ? allViolations.filter((v) => v.severity === severity)
    : allViolations;

  const criticalCount = filteredViolations.filter((v) => v.severity === 'critical').length;
  const warningCount = filteredViolations.filter((v) => v.severity === 'warning').length;

  return {
    profile,
    generated_at: new Date().toISOString(),
    total_responses_checked: responsesChecked,
    total_violations: filteredViolations.length,
    critical_violations: criticalCount,
    warning_violations: warningCount,
    violations: filteredViolations,
    passed: criticalCount === 0,
  };
}

// ---------------------------------------------------------------------------
// Knowledge loader helper
// ---------------------------------------------------------------------------

export function loadKnowledge(profile: string): KnowledgeEntry[] {
  const candidates = [
    path.join(__dirname, '..', 'assistant', `data-${profile}`, 'knowledge.json'),
    path.join(DATA_DIR, 'knowledge.json'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      const data = JSON.parse(raw);
      if (data.static && Array.isArray(data.static)) {
        return data.static as KnowledgeEntry[];
      }
    }
  }

  throw new Error(`Could not find knowledge.json for profile: ${profile}`);
}
