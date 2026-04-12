#!/bin/bash

# Profile Content Separation Audit Report Generator
#
# This script generates a CSV report identifying potential copy-paste contamination
# between different profile data files using TF-IDF cosine similarity.
#
# Usage:
#   bash scripts/audit-profiles.sh --output audit-report.csv --threshold 0.7
#
# Arguments:
#   --output <file>      Output CSV file (default: audit-report.csv)
#   --threshold <score>  Similarity threshold 0.0-1.0 (default: 0.7)

set -euo pipefail

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Default values
OUTPUT_FILE="audit-report.csv"
THRESHOLD="0.7"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: bash scripts/audit-profiles.sh [--output FILE] [--threshold SCORE]"
      exit 1
      ;;
  esac
done

echo "Profile Content Separation Audit"
echo "================================="
echo "Output file: $OUTPUT_FILE"
echo "Threshold: $THRESHOLD"
echo ""

# Run the TypeScript tool
cd "$PROJECT_ROOT"
npx tsx src/tools/audit-profiles.ts --output "$OUTPUT_FILE" --threshold "$THRESHOLD"

# Verify output was created
if [ -f "$OUTPUT_FILE" ]; then
  echo ""
  echo "✓ Report generated successfully"
  echo ""
  echo "First 5 rows of report:"
  head -6 "$OUTPUT_FILE"
else
  echo "✗ Failed to generate report"
  exit 1
fi
