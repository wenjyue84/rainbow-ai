#!/usr/bin/env bash
# spiral-validate.sh — Runs vitest and generates SPIRAL-compatible report.json
# Used by SPIRAL_VALIDATE_CMD in spiral.config.sh
set -uo pipefail

REPORT_DIR="test-reports/latest"
mkdir -p "$REPORT_DIR"

# Run vitest, capture exit code (don't exit on failure)
_exit=0
NODE_OPTIONS='--max-old-space-size=4096' npx vitest run --reporter=default --reporter=json --outputFile="$REPORT_DIR/vitest.json" 2>&1 || _exit=$?

# Convert vitest JSON → SPIRAL report.json format
node -e "
const fs = require('fs');
const outPath = '$REPORT_DIR/report.json';
try {
  const v = JSON.parse(fs.readFileSync('$REPORT_DIR/vitest.json', 'utf8'));
  const report = {
    summary: {
      passed: v.numPassedTests || 0,
      failed: v.numFailedTests || 0,
      total: v.numTotalTests || 0,
      errored: 0
    }
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('[spiral-validate] Report written:', JSON.stringify(report.summary));
} catch(e) {
  // Fallback: create minimal report based on exit code
  const ok = ${_exit} === 0;
  const report = { summary: { passed: ok ? 1 : 0, failed: ok ? 0 : 1, total: 1, errored: 0 } };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('[spiral-validate] Fallback report written:', JSON.stringify(report.summary));
}
"

exit $_exit
