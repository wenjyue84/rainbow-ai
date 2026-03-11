# Intent Accuracy Review — 2026-02-15

**Reviewer:** Claude Code (Automated Analysis)
**Test Date:** 2026-02-15
**Dashboard Claimed Accuracy:** 97%
**Actual Measured Accuracy:** **26.92%**

## Executive Summary

⚠️ **CRITICAL FINDING:** The Rainbow AI intent classification system has a **70.08 percentage point gap** between displayed accuracy (97%) and actual intent matching accuracy (26.92%).

### Root Cause Analysis

1. **Dashboard Metric Mismatch**
   - The 97% shown in dashboard measures **response quality validation** (whether responses contain expected keywords)
   - This does NOT measure **intent classification accuracy** (whether the correct intent category is identified)

2. **LLM Generic Intent Names**
   - The LLM classifier returns generic intent names: `complaint`, `facilities`, `payment`, `rules`
   - These don't match the specific defined intents: `climate_control_complaint`, `facilities_info`, `payment_info`, `rules_policy`
   - Result: 73% of tests fail intent matching despite generating acceptable responses

3. **Missing Tier 1/2 Triggers**
   - Most classifications go through LLM (source: "llm") at 80-100% confidence
   - Tier 1 (Regex) and Tier 2 (Keyword) rarely trigger
   - This means fast-path matching is not working, increasing latency and cost

## Detailed Test Results

### Overall Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Tests** | 56 | 100% |
| **Correct Intent Match** | 14 | 25.0% |
| **Incorrect Intent Match** | 38 | 67.9% |
| **Errors** | 0 | 0% |
| **Edge Cases (Flexible)** | 4 | 7.1% |
| **ACTUAL ACCURACY** | **26.92%** | - |

### Performance by Journey Phase

| Phase | Total | Correct | Accuracy |
|-------|-------|---------|----------|
| GENERAL_SUPPORT | 4 | 4 | **100%** ✓ |
| PRE_ARRIVAL | 11 | 5 | **45.5%** |
| ARRIVAL_CHECKIN | 4 | 1 | **25.0%** |
| DURING_STAY | 15 | 0 | **0%** ❌ |
| CHECKOUT_DEPARTURE | 5 | 0 | **0%** ❌ |
| POST_CHECKOUT | 9 | 0 | **0%** ❌ |
| MULTILINGUAL | 4 | 3 | **75.0%** |
| EDGE_CASES | 4 | 4 | **100%** ✓ |

## Critical Issues by Category

### 🔴 **0% Accuracy — DURING_STAY (All 15 tests failed)**

These are time-sensitive complaints requiring immediate resolution. **Zero correct classifications.**

#### Climate Control (0/2 correct)
- ❌ "My room is too cold!" → Expected: `climate_control_complaint` | Got: `complaint`
- ❌ "It is way too hot in here" → Expected: `climate_control_complaint` | Got: `complaint`

#### Noise Complaints (0/3 correct)
- ❌ "The people next door are too loud!" → Expected: `noise_complaint` | Got: `complaint`
- ❌ "There is construction noise outside" → Expected: `noise_complaint` | Got: `unknown`
- ❌ "A baby has been crying all night" → Expected: `noise_complaint` | Got: `complaint`

#### Cleanliness (0/2 correct)
- ❌ "My room is dirty!" → Expected: `cleanliness_complaint` | Got: `complaint`
- ❌ "The bathroom smells terrible" → Expected: `cleanliness_complaint` | Got: `unknown`

#### Facility Issues (0/1 correct)
- ❌ "The AC is not working" → Expected: `facility_malfunction` | Got: `complaint`

#### Security & Emergencies (0/3 correct)
- ❌ "My card is locked inside!" → Expected: `card_locked` | Got: `unknown`
- ❌ "Someone stole my laptop!" → Expected: `theft_report` | Got: `unknown`
- ❌ "My jewelry is missing from the safe" → Expected: `theft_report` | Got: `unknown`

#### Service Requests (0/4 correct)
- ❌ "This service is terrible!" → Expected: `general_complaint_in_stay` | Got: `complaint`
- ❌ "Can I get more towels?" → Expected: `extra_amenity_request` | Got: `general`
- ❌ "I need an extra pillow please" → Expected: `extra_amenity_request` | Got: `general`
- ❌ "What attractions are nearby?" → Expected: `tourist_guide` | Got: `unknown`

**Impact:** Guests with urgent issues (theft, locked out, facility breakdown) are not being routed to correct escalation workflows.

### 🔴 **0% Accuracy — CHECKOUT_DEPARTURE (All 5 tests failed)**

- ❌ "How do I check out?" → Expected: `checkout_procedure` | Got: `checkout_info`
- ❌ "Can I checkout at 3 PM?" → Expected: `late_checkout_request` | Got: `checkout_info`
- ❌ "Can I check out at 6 PM?" → Expected: `late_checkout_request` | Got: `checkout_info`
- ❌ "Can I leave my bags after checkout?" → Expected: `luggage_storage` | Got: `checkout_info`
- ❌ "There is an extra charge on my bill" → Expected: `billing_inquiry` | Got: `unknown`

**Pattern:** All checkout-related intents lumped into generic `checkout_info` instead of specific actions.

### 🔴 **0% Accuracy — POST_CHECKOUT (All 9 tests failed)**

#### Forgot Items (0/3 correct)
- ❌ "I left my phone charger in the room" → Expected: `forgot_item_post_checkout` | Got: `complaint`
- ❌ "I think I left my passport behind!" → Expected: `forgot_item_post_checkout` | Got: `complaint`
- ❌ "Left some clothes in the room" → Expected: `forgot_item_post_checkout` | Got: `complaint`

#### Billing Disputes (0/2 correct)
- ❌ "I was overcharged by RM50" → Expected: `billing_dispute` | Got: `unknown`
- ❌ "Small discrepancy in my bill" → Expected: `billing_dispute` | Got: `unknown`

#### Post-Checkout Complaints (0/2 correct)
- ❌ "The food was awful during my stay" → Expected: `post_checkout_complaint` | Got: `unknown`
- ❌ "After checking out, I want to complain about poor service" → Expected: `post_checkout_complaint` | Got: `unknown`

#### Reviews (0/2 correct)
- ❌ "Great experience! Highly recommend" → Expected: `review_feedback` | Got: `thanks`
- ❌ "Worst hotel ever. Terrible service." → Expected: `review_feedback` | Got: `complaint`

**Pattern:** System cannot distinguish between complaint types or recognize post-checkout context.

### 🟡 **45.5% Accuracy — PRE_ARRIVAL (5/11 correct)**

**Working:**
- ✓ "How much is a room?" → `pricing`
- ✓ "Do you have rooms on June 15th?" → `availability`
- ✓ "How do I book?" → `booking`
- ✓ "How do I get from the airport?" → `directions`
- ✓ "What time can I check in?" → `checkin_info`
- ✓ "When is checkout?" → `checkout_info`

**Failing:**
- ❌ "What facilities do you have?" → Expected: `facilities_info` | Got: `facilities`
- ❌ "What are the rules?" → Expected: `rules_policy` | Got: `rules`
- ❌ "Are pets allowed?" → Expected: `rules_policy` | Got: `facilities`
- ❌ "What payment methods do you accept?" → Expected: `payment_info` | Got: `payment`
- ❌ "I already paid via bank transfer" → Expected: `payment_made` | Got: `payment`

**Pattern:** Generic LLM returns shortened intent names (`facilities` vs `facilities_info`, `rules` vs `rules_policy`).

### 🟡 **25% Accuracy — ARRIVAL_CHECKIN (1/4 correct)**

**Working:**
- ✓ "What is the WiFi password?" → `wifi`

**Failing:**
- ❌ "I want to check in" → Expected: `check_in_arrival` | Got: `checkin_info`
- ❌ "Can I get a lower deck?" → Expected: `lower_deck_preference` | Got: `unknown`
- ❌ "Where is the bathroom?" → Expected: `facility_orientation` | Got: `facilities`

### ✅ **100% Accuracy — GENERAL_SUPPORT (4/4 correct)**

- ✓ "Hi there!" → `greeting`
- ✓ "Selamat pagi" → `greeting`
- ✓ "Thank you!" → `thanks`
- ✓ "I need to speak to staff" → `contact_staff`

**Analysis:** Simple, high-frequency intents work because they have strong Tier 1 regex patterns.

### ✅ **100% Accuracy — EDGE_CASES (4/4 correct)**

- ✓ Gibberish → `unknown` (no errors)
- ✓ Emoji only → `unknown` (no errors)
- ✓ Very long message → classified correctly
- ✓ Prompt injection → rejected safely

**Analysis:** System handles edge cases well.

## Recommended Accuracy Target

Based on the review, here is my assessment:

### **Revised Accuracy: 26.92% → Target: 85%+**

**Breakdown by Fix Priority:**

| Fix | Impact | Estimated Gain | New Accuracy |
|-----|--------|----------------|--------------|
| **Current** | - | - | **26.92%** |
| 1. Fix LLM intent name mapping | HIGH | +35% | ~62% |
| 2. Add Tier 2 keywords for complaints | HIGH | +15% | ~77% |
| 3. Add context-aware routing (post-checkout) | MEDIUM | +5% | ~82% |
| 4. Add Tier 1 regex for emergencies | HIGH | +3% | ~85% |
| **Target** | - | - | **85%+** ✓ |

## Action Items

### 🔥 **Immediate (P0) — Fix Critical Misclassifications**

1. **Map LLM generic names to specific intents**
   - Problem: LLM returns `complaint`, `facilities`, `payment`, `rules`
   - Fix: Add post-processing mapping layer in `intents.js`
   - Files: `RainbowAI/src/assistant/intents.js`

2. **Add Tier 2 keywords for all complaint subtypes**
   - Problem: Zero DURING_STAY intents classified correctly
   - Fix: Add strong keywords to `intent-keywords.json`:
     - `climate_control_complaint`: "too cold", "too hot", "temperature", "AC"
     - `noise_complaint`: "loud", "noisy", "can't sleep", "quiet"
     - `cleanliness_complaint`: "dirty", "smell", "unclean", "stain"
     - `theft_report`: "stolen", "stole", "theft", "missing from safe"
     - `card_locked`: "locked inside", "card locked", "can't get in"
   - Files: `RainbowAI/src/assistant/data/intent-keywords.json`

3. **Add emergency Tier 1 regex patterns**
   - Problem: Theft and lockout not detected
   - Fix: Add high-priority regex to `intents.json`:
     - `theft_report`: `\\b(stole|stolen|theft|rob)\\b`
     - `card_locked`: `\\b(locked\\s?(out|inside)|can'?t\\s?get\\s?in)\\b`
   - Files: `RainbowAI/src/assistant/data/intents.json`

### 📅 **Short-term (P1) — Improve Specificity**

4. **Distinguish checkout info vs procedure vs late request**
   - Add keywords: "late checkout" → `late_checkout_request`, "how to check out" → `checkout_procedure`

5. **Fix payment differentiation**
   - `payment_info` (asking): "what payment", "how to pay"
   - `payment_made` (confirming): "already paid", "I paid", "transfer done"

6. **Add post-checkout context detection**
   - Keywords: "after checkout", "already left", "was there", "during my stay"
   - Route to post-checkout intents instead of generic complaint

### 🔄 **Long-term (P2) — System Improvements**

7. **Switch from LLM-first to Tier-first**
   - Current: Most classifications skip Tier 1/2 and go straight to LLM
   - Target: 60%+ handled by Tier 1/2 (faster, cheaper, more accurate)

8. **Add confidence threshold tuning**
   - Many LLM classifications at 80-100% confidence are wrong
   - Consider lowering min_confidence for specific intents

9. **Implement conversation context**
   - Track if guest has checked out
   - Use context to prefer post-checkout intents over generic ones

## Files to Review/Update

| Priority | File | Changes Needed |
|----------|------|----------------|
| **P0** | `src/assistant/intents.js` | Add LLM→specific intent mapping |
| **P0** | `src/assistant/data/intent-keywords.json` | Add complaint subtype keywords |
| **P0** | `src/assistant/data/intents.json` | Add emergency regex patterns |
| **P1** | `src/assistant/data/routing.json` | Verify routing for new specific intents |
| **P1** | `src/assistant/fuzzy-matcher.ts` | Tune confidence thresholds |
| **P2** | `src/assistant/message-router.ts` | Add context-aware routing |

## Conclusion

**The 97% accuracy shown in the dashboard is misleading.** It measures whether responses contain expected keywords, not whether the system identifies the correct intent category.

The actual intent classification accuracy of **26.92%** means:
- ❌ **73% of guest messages are misclassified**
- ❌ **100% of urgent complaints (theft, lockout, AC breakdown) route incorrectly**
- ❌ **100% of checkout-related requests route incorrectly**
- ❌ **100% of post-checkout issues route incorrectly**

**Impact on Guest Experience:**
- Urgent issues (theft, locked out) → routed as generic "unknown" → slow staff response
- Checkout requests → lumped into generic "checkout_info" → wrong workflow triggered
- Complaints → classified as generic "complaint" → no severity-based escalation

**Recommended Action:**
Implement P0 fixes immediately to reach **85%+ accuracy** within 1-2 days:
1. Fix LLM intent name mapping (2 hours)
2. Add Tier 2 keywords for complaints (3 hours)
3. Add emergency regex patterns (1 hour)

---

**Test Run Details:**
- Date: 2026-02-15
- Test Scenarios: 56
- Duration: 95.92 seconds
- Results: `reports/intent-accuracy/test-2026-02-15T02-44-39-261Z.json`
