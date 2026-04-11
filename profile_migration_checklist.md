# Profile Data Migration Checklist

**Generated:** 11/04/2026, 6:08:04 pm
**Total Steps:** 8

## Overview

This checklist provides step-by-step instructions to remove contaminated keywords from profile data files.
Each step includes grep commands to verify the fix was applied correctly.

## Migration Steps

### Step 1: Intent 'checkout_procedure' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json
2. Find the intent route for "checkout_procedure" at lines 99
3. Delete the line: "checkout_procedure": { ... }
4. Verify with: grep "checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json"
```

**Verification Command (after removal):**

```bash
grep "checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"
```

---

### Step 2: Intent 'late_checkout' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json
2. Find the intent route for "late_checkout" at lines 102
3. Delete the line: "late_checkout": { ... }
4. Verify with: grep "late_checkout" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "late_checkout" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json"
```

**Verification Command (after removal):**

```bash
grep "late_checkout" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"
```

---

### Step 3: Intent 'checkout_now' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json
2. Find the intent route for "checkout_now" at lines 47
3. Delete the line: "checkout_now": { ... }
4. Verify with: grep "checkout_now" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "checkout_now" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json"
```

**Verification Command (after removal):**

```bash
grep "checkout_now" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"
```

---

### Step 4: Intent 'checkout_info' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json
2. Find the intent route for "checkout_info" at lines 44
3. Delete the line: "checkout_info": { ... }
4. Verify with: grep "checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json"
```

**Verification Command (after removal):**

```bash
grep "checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\routing.json" || echo "Successfully removed"
```

---

### Step 5: Keyword 'checkout_info' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json
2. Find the keyword entry for "checkout_info" at lines 255
3. Remove the entire keyword definition block
4. Verify with: grep "checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json"
```

**Verification Command (after removal):**

```bash
grep "checkout_info" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"
```

---

### Step 6: Keyword 'late_checkout' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json
2. Find the keyword entry for "late_checkout" at lines 290
3. Remove the entire keyword definition block
4. Verify with: grep "late_checkout" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "late_checkout" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json"
```

**Verification Command (after removal):**

```bash
grep "late_checkout" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"
```

---

### Step 7: Keyword 'checkout_now' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json
2. Find the keyword entry for "checkout_now" at lines 1480
3. Remove the entire keyword definition block
4. Verify with: grep "checkout_now" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "checkout_now" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json"
```

**Verification Command (after removal):**

```bash
grep "checkout_now" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"
```

---

### Step 8: Keyword 'checkout_procedure' from Pelangi Capsule found in Southern Homestay

**Profile:** Southern Homestay
**File:** `C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json`

**Removal Instructions:**

1. Open file: C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json
2. Find the keyword entry for "checkout_procedure" at lines 1521
3. Remove the entire keyword definition block
4. Verify with: grep "checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"

**Grep Command (to locate):**

```bash
grep -n "checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json"
```

**Verification Command (after removal):**

```bash
grep "checkout_procedure" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern\intent-keywords.json" || echo "Successfully removed"
```

---

## Verification Checklist

After completing all steps, run these commands to verify clean state:

```bash
# Check all profiles are clean
grep -E "checkout_procedure|late_checkout|card_locked|capsule_conflict" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-makan/routing.json" || echo "makan is clean"
grep -E "checkout_procedure|late_checkout|card_locked|capsule_conflict" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data/routing.json" || echo "pelangi is clean"
grep -E "checkout_procedure|late_checkout|card_locked|capsule_conflict" "C:\Users\Jyue\Documents\1-projects\Software Projects\rainbow-ai\src\assistant\data-southern/routing.json" || echo "southern is clean"
```

