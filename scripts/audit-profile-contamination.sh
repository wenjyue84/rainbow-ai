#!/usr/bin/env bash
# US-246: Audit Makan Moments profile data files for Pelangi Capsule keyword contamination
#
# Scans src/assistant/data-makan/ files (knowledge.json, routing.json, intent-keywords.json)
# for hostel-specific keywords that indicate cross-profile contamination.
#
# Output: CSV report to stdout with columns:
#   filename, line_number, contaminated_term, suggested_replacement
#
# Exit codes:
#   0 — No hostel keywords found in Makan Moments profile (clean)
#   1 — Hostel keywords detected (contamination found)
#
# Usage:
#   bash scripts/audit-profile-contamination.sh
#   bash scripts/audit-profile-contamination.sh > report.csv

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_MAKAN="$ROOT_DIR/src/assistant/data-makan"

# Files to audit (AC specifies knowledge.json, routing.json, intent-keywords.json)
TARGET_FILES=(
  "knowledge.json"
  "routing.json"
  "intent-keywords.json"
)

# Hostel-specific keywords and their cafe-appropriate replacements
# Format: "keyword|suggested_replacement"
declare -a HOSTEL_TERMS=(
  "room|table"
  "guest|customer"
  "check-in|visit"
  "checkin|visit"
  "checkout|payment"
  "check-out|payment"
  "booking confirmation|order confirmation"
  "booking|reservation"
  "capsule|cafe"
  "hostel|cafe"
  "dorm|cafe"
  "dormitory|cafe"
  "pelangi|makan moments"
  "accommodation|dining"
  "staying|dining"
  "bed|seat"
  "deck|counter"
  "lower deck|counter"
  "key card|loyalty card"
  "door password|wifi password"
  "room availability|table availability"
  "arrival|visit"
  "departure|farewell"
  "capsule pod|dining area"
  "amenities|services"
)

contamination_found=0

# Print CSV header
echo "filename,line_number,contaminated_term,suggested_replacement"

# Scan each target file using grep -inF for each term (fast, no per-line subprocess)
for file in "${TARGET_FILES[@]}"; do
  filepath="$DATA_MAKAN/$file"
  if [ ! -f "$filepath" ]; then
    continue
  fi

  for entry in "${HOSTEL_TERMS[@]}"; do
    term="${entry%%|*}"
    replacement="${entry##*|}"

    # Use grep -inF: case-insensitive, line numbers, fixed string
    while IFS=: read -r line_num _match_line; do
      echo "\"$file\",$line_num,\"$term\",\"$replacement\""
      contamination_found=1
    done < <(grep -inF "$term" "$filepath" 2>/dev/null || true)
  done
done

if [ "$contamination_found" -eq 1 ]; then
  exit 1
else
  exit 0
fi
