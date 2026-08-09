# Rainbow AI — Spiral Constitution
## Yoong Mei Trading And Transport — Logistics Enquiry Assistant

> **Full business requirements:** [docs/yoongmei-requirements.md](docs/yoongmei-requirements.md)
> **Profile ID:** `yoongmei` | **Webchat:** `/chat/yoongmei`

---

### Core Rule: Every Story Must Be Visible & Felt

Every user story MUST produce a change that:
- A **customer** can see or feel directly in their webchat conversation, OR
- A **staff member** receives as a WhatsApp notification or in the admin dashboard

Reject or deprioritise: internal refactors, logging improvements, schema changes,
or infrastructure work UNLESS they directly unblock a visible customer/staff feature.

---

### Verified Working Behaviours (as of 2026-03-24)

These behaviours have been tested and confirmed working against the live endpoint:

| Scenario | Expected | Status |
|----------|----------|--------|
| Greeting ("Hello") | Static welcome with CTA buttons | ✅ |
| Services query (EN) | Lists LCL, FCL, Console, Cross-border clearly | ✅ |
| Services query (MS) | Responds in Malay with full service list | ✅ |
| Rate to JB (e.g. 3 pallets) | Shows RM 160/pallet × 3 = RM 480 with caveat | ✅ |
| Rate to Penang Island (5 pallets) | Shows RM 145/pallet with caveat | ✅ |
| Rate to Penang Mainland (5 pallets) | Shows RM 120/pallet with caveat | ✅ |
| Rate to Melaka in Malay | Shows lori/charter rates in Malay with caveat | ✅ |
| LCL vs FCL explanation | Clear distinction with lorry sizes | ✅ |
| Singapore cross-border | Confirms service, collects full enquiry | ✅ |
| Quote request (10 pallets to KL) | Maps KL→Selangor, asks for 8 fields | ✅ |

---

### Customer-Side Visible Improvements (Webchat)

Stories that improve these MUST be prioritised:

1. **Pricing first** — When customers ask for rates, the bot MUST show the relevant
   rate table BEFORE asking for full enquiry details. Never jump straight to collecting
   8 fields when the customer only asked "how much?"
2. **Enquiry collection flow** — The AI must guide customers through all 8 required fields
   (name, pickup, delivery, commodity, quantity, weight, dimension, billing details)
   in a natural conversational flow, not a rigid form dump
3. **Partial progress persistence** — If a customer provides 3 out of 8 fields, the bot
   must remember what was already given and only ask for what's missing
4. **Route not covered** — Graceful response when the destination is not in the price list:
   collect full enquiry and escalate, do NOT invent a number
5. **Language handling** — Support English and Malay naturally; don't break on mixed input
6. **Escalation confirmation** — After collecting all fields, show a clear summary to the
   customer and confirm it has been forwarded to the Yoong Mei team
7. **Clean response format** — No emoji signatures (e.g. "— Rainbow 🌈") in replies;
   professional B2B tone throughout

### Staff-Side Visible Improvements

Stories that improve these MUST be prioritised:

1. **WhatsApp notification** — When all 8 enquiry fields are collected, staff receives a
   formatted WhatsApp message with the complete enquiry details
2. **Escalation for unknowns** — When the AI cannot answer, staff gets a notification with
   the original question and customer context so they can follow up
3. **Enquiry summary quality** — Notification must be structured and scannable:
   customer name, origin, destination, commodity, qty/weight/dimensions, billing info

---

### What Is Out of Scope (Reject These Stories)

- Stories that automate the actual quoting or booking — humans must confirm
- Generic code quality improvements with no user-visible output
- Features from the `pelangi`, `southern`, or `makan-moments` profiles bleeding into `yoongmei`
- Stories touching only test files or config files with no UX change
- Performance optimisations under 100ms that users cannot perceive

---

### Known Issues & Next Priorities

1. **Malay pricing queries intermittently fail** — When the primary AI provider (Gemini Flash)
   times out and falls back to Groq, Malay pricing queries can occasionally return the
   unknownFallback message instead of rates. Root cause: provider reliability, not KB config.
   Fix: Add a third reliable provider or increase timeout tolerance.

2. **"urgently" escalation pattern gap** — The word `urgently` (with `-ly` suffix) did NOT
   match the escalation regex `\burgent\b`. Fixed in `intents.json` by adding `urgently`.
   Similarly `damaged` now triggers escalation. Verify in production.

3. **Escalation missing staff notification** — The `escalate_human` intent uses `static_reply`
   (returns a canned message only). It does NOT yet send a WhatsApp notification to staff
   when the customer asks to escalate. This is the highest-priority unimplemented feature.

4. **soul.md reverts** — An external file watcher (IDE/formatter) is reverting soul.md to
   an older version. Critical rules (pricing-first, no emoji signature, 8 fields) must be
   maintained in `settings.json` system_prompt instead, which is DB-backed and stable.

---

### Acceptance Criteria Standards

Every story's acceptance criteria MUST include at least one of:
- "Customer sees [X] in webchat"
- "Staff receives [X] as WhatsApp notification"
- "When customer provides [X], the bot responds with [Y]"
- "When customer asks about rate to [destination], the bot shows [correct rate row]"
- "After collecting all fields, bot sends summary [Z] to staff"

---

### Profile Isolation Rule

All data and KB files for `yoongmei` live exclusively in:
- KB: `.rainbow-kb-yoongmei/`
- Data: `src/assistant/data-yoongmei/`

Zero content from `pelangi`, `southern`, or `makan-moments` may appear here.
Spiral MUST validate this before each commit.

---

### Config Files (Stable, DB-backed)

| File | Purpose | Key Changes |
|------|---------|-------------|
| `data-yoongmei/settings.json` | System prompt, AI providers, rate limits | Added no-emoji rule; max_chat_tokens → 900 |
| `data-yoongmei/kb-patterns.json` | KB file routing by keyword | Added Malay terms (harga, berapa, kadar) + all destinations |
| `data-yoongmei/intents.json` | T2 regex intent classification | Fixed pricing patterns bidirectionality; fixed escalation keywords |
| `data-yoongmei/routing.json` | Intent → action mapping | `escalate_human` uses `static_reply` |
| `.rainbow-kb-yoongmei/pricing.md` | Rate table (authoritative) | Covers JB, Melaka, Selangor, Rawang, Ipoh, Penang, SG/TH |
| `.rainbow-kb-yoongmei/services.md` | Service descriptions | LCL, FCL, Console, Cross-border |
