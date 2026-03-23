/**
 * US-301: Violation schema and validation helpers
 *
 * TypeScript types and utility functions for violation reporting.
 * Used by booking preflight validation (US-302, US-303, US-304).
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface Violation {
  violation_type: string;
  description: string;
  impact_level: 'critical' | 'warning';
  suggested_fix: string;
}

export interface PreflightResult {
  passed: boolean;
  violations: Violation[];
  warnings: Violation[];
  estimated_revenue: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Create a Violation object with the given parameters.
 */
export function createViolation(
  type: string,
  description: string,
  level: 'critical' | 'warning',
  suggestedFix: string
): Violation {
  return {
    violation_type: type,
    description,
    impact_level: level,
    suggested_fix: suggestedFix,
  };
}

/**
 * Separate an array of violations into critical violations and warnings
 * based on their impact_level.
 */
export function separateByLevel(allViolations: Violation[]): {
  violations: Violation[];
  warnings: Violation[];
} {
  const violations: Violation[] = [];
  const warnings: Violation[] = [];

  for (const v of allViolations) {
    if (v.impact_level === 'critical') {
      violations.push(v);
    } else {
      warnings.push(v);
    }
  }

  return { violations, warnings };
}
