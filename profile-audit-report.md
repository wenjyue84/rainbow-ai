# Profile Data Audit Report

**Generated:** 11/04/2026, 6:08:04 pm

## Summary

| Metric | Count |
|--------|-------|
| Total Issues Found | 8 |
| Profiles Analyzed | 3 |
| Files Analyzed | 65 |
| Affected Files | 2 |
| High Confidence Issues | 8 |

## Issues by Profile

### Makan Moments (makan)

Issues found: **0**

### Pelangi Capsule (pelangi)

Issues found: **0**

### Southern Homestay (southern)

Issues found: **8**

- **checkout_procedure** (intent_route)
  - Location: `routing.json:99`
  - Occurrences: 1
  - Confidence: 90%
  - Issue: Intent 'checkout_procedure' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **late_checkout** (intent_route)
  - Location: `routing.json:102`
  - Occurrences: 1
  - Confidence: 90%
  - Issue: Intent 'late_checkout' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **checkout_now** (intent_route)
  - Location: `routing.json:47`
  - Occurrences: 1
  - Confidence: 90%
  - Issue: Intent 'checkout_now' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **checkout_info** (intent_route)
  - Location: `routing.json:44`
  - Occurrences: 1
  - Confidence: 90%
  - Issue: Intent 'checkout_info' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **checkout_info** (keyword)
  - Location: `intent-keywords.json:255`
  - Occurrences: 1
  - Confidence: 85%
  - Issue: Keyword 'checkout_info' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **late_checkout** (keyword)
  - Location: `intent-keywords.json:290`
  - Occurrences: 1
  - Confidence: 85%
  - Issue: Keyword 'late_checkout' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **checkout_now** (keyword)
  - Location: `intent-keywords.json:1480`
  - Occurrences: 1
  - Confidence: 85%
  - Issue: Keyword 'checkout_now' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

- **checkout_procedure** (keyword)
  - Location: `intent-keywords.json:1521`
  - Occurrences: 1
  - Confidence: 85%
  - Issue: Keyword 'checkout_procedure' from Pelangi Capsule found in Southern Homestay
  - Source: Pelangi Capsule

## Files Affected

### southern/routing.json

Contaminated entries: 4

```bash
# View all issues in this file:
grep -n "checkout_procedure|late_checkout|checkout_now|checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json"
```

### southern/intent-keywords.json

Contaminated entries: 4

```bash
# View all issues in this file:
grep -n "checkout_info|late_checkout|checkout_now|checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json"
```

