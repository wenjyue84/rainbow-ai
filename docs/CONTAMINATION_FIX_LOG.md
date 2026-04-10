# Profile Data Contamination Fix Log

**Date:** 2026-03-24
**Story:** US-353 - Fix Makan Moments and Southern Homestay Profile Data Contamination
**Status:** ✅ COMPLETED

---

## Summary

Manually audited and removed all Pelangi Capsule Hostel-specific content from `data-makan` and `data-southern` profiles. Verified zero contamination remains.

---

## Files Modified

### 1. `src/assistant/data-makan/intent-examples.json`

**Contamination Removed:**
- **directions intent (English)**: Removed "where is the hostel" (1 line)
- **directions intent (Malay)**: Removed "alamat hostel" (1 line)
- **contact_staff intent (English)**: Removed 6 baby crying examples:
  - "A baby has been crying all night"
  - "There is too much noise from babies"
  - "Baby noise keeping me awake"
  - "Baby crying all night"
  - "Can't sleep because of baby crying"
  - "The baby won't stop crying"
- **contact_staff intent (Malay)**: Removed 3 baby-related examples:
  - "Bayi menangis semalaman"
  - "Baby bising sangat"
  - "Tangisan bayi tak henti"
- **contact_staff intent (Chinese)**: Removed 3 baby-related examples:
  - "婴儿哭了整晚"
  - "婴儿太吵了"
  - "婴儿一直哭"

**Total lines removed: 14 contaminated entries**

---

## Files Deleted

### 1. `src/assistant/data-makan/pelangi-kb.md.contaminated`
- **Status:** Deleted
- **Content:** Full Pelangi Capsule Hostel knowledge base (WiFi passwords, address, facilities, capsule references)
- **Size:** 2,061 bytes

### 2. `src/assistant/data-southern/pelangi-kb.md.contaminated`
- **Status:** Deleted
- **Content:** Full Pelangi Capsule Hostel knowledge base (WiFi passwords, address, facilities, capsule references)
- **Size:** 2,061 bytes

---

## Verification Results

### data-makan Profile ✅
**Active Files Checked:**
- `intents.json` — ✅ CLEAN (cafe intents only)
- `intent-keywords.json` — ✅ CLEAN (cafe keywords only)
- `intent-examples.json` — ✅ CLEAN (hostel references removed)
- `routing.json` — ✅ CLEAN
- `workflows.json` — ✅ CLEAN
- `knowledge.json` — ✅ CLEAN
- `settings.json` — ✅ CLEAN

**Grep verification for: pelangi, capsule, hostel, bed, dorm**
- Result: ✅ **0 matches found** in active files (only .backup files remain with no impact)

---

### data-southern Profile ✅
**Active Files Checked:**
- `intents.json` — ✅ CLEAN (Southern Homestay-specific, no Pelangi references)
- `intent-keywords.json` — ✅ CLEAN (no Pelangi references)
- `intent-examples.json` — ✅ CLEAN (no Pelangi references)
- `routing.json` — ✅ CLEAN
- `workflows.json` — ✅ CLEAN (uses "Southern Homestay", not Pelangi)
- `knowledge.json` — ✅ CLEAN
- `settings.json` — ✅ CLEAN

**Grep verification for: pelangi, capsule (Pelangi brand)**
- Result: ✅ **0 matches found** in active files

---

## Profile-Specific Content Verification

### data-makan (Makan Moments Cafe) ✅
**Intent Categories Present:**
- ✅ CAFE_OPERATIONS: menu_query, menu_browse_category, order_placement, order_status, operating_hours, food_recommendation, vegetarian_query, allergen_query, menu_filter_dietary, budget_query, specials_query, menu_item_detail, table_reservation, order_feedback_rating
- ✅ GENERAL_SUPPORT: greeting, thanks, contact_staff, review_feedback, unknown
- ✅ PRE_VISIT: pricing, directions, cafe_payment_info

**Excluded (Correctly Removed):**
- ❌ check_in (hostel intent)
- ❌ check_out (hostel intent)
- ❌ room_service (hostel intent)
- ❌ hostel_amenities (hostel intent)

---

### data-southern (Southern Homestay) ✅
**Content Type:**
- All references use "Southern Homestay" or generic homestay/guest language
- No Pelangi Capsule Hostel references found

---

## Quality Checks

### Build Status
```
✅ npm run build — PASSED
  - No compilation errors
  - Pre-existing ESM warning in logger.ts (unrelated)
  - Bundle size: 2.4mb
  - Time: 151ms
```

### Server Startup
```
✅ Server starts successfully
  - Connection string loads
  - Configuration loaded
  - No contamination-related errors
```

---

## Summary of Changes

| Profile | Action | Files | Status |
|---------|--------|-------|--------|
| data-makan | Remove hostel examples | intent-examples.json | ✅ 14 lines removed |
| data-makan | Delete contaminated KB | pelangi-kb.md.contaminated | ✅ Deleted |
| data-southern | Delete contaminated KB | pelangi-kb.md.contaminated | ✅ Deleted |
| All | Verify no Pelangi refs | *.json, *.md | ✅ Zero found |

---

## Acceptance Criteria Status

✅ **AC1:** Remove from data-makan hostel-specific intents and keywords
  - ✅ Removed 14 hostel/baby-related examples
  - ✅ Verified only cafe intents remain

✅ **AC2:** Remove from data-southern: Pelangi keywords and intents
  - ✅ Deleted contaminated KB file
  - ✅ Verified zero Pelangi/capsule references

✅ **AC3:** Create CONTAMINATION_FIX_LOG.md documenting all changes
  - ✅ This document created
  - ✅ Files modified, lines removed listed
  - ✅ Profile-specific content verified

---

## No Further Action Needed

All Pelangi Capsule Hostel contamination has been removed from Makan Moments and Southern Homestay data profiles.
