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

### Customer-Side Visible Improvements (Webchat)

Stories that improve these MUST be prioritised:

1. **Enquiry collection flow** — The AI must guide customers through all 7 required fields
   (name, pickup, delivery, commodity, quantity, weight, dimension, billing details)
   in a natural conversational flow, not a rigid form dump
2. **Partial progress persistence** — If a customer provides 3 out of 7 fields, the bot
   must remember what was already given and only ask for what's missing
3. **Pricing guidance** — When customers ask for rates, the bot must look up the correct
   destination row from the pricing table and present it clearly, with the caveat that
   final rates are confirmed by staff
4. **Route not covered** — Graceful response when the destination is not in the price list:
   collect full enquiry and escalate, do NOT invent a number
5. **Language handling** — Support English and Malay naturally; don't break on mixed input
6. **Escalation confirmation** — After collecting all fields, show a clear summary to the
   customer and confirm it has been forwarded to the Yoong Mei team

### Staff-Side Visible Improvements

Stories that improve these MUST be prioritised:

1. **WhatsApp notification** — When all 7 enquiry fields are collected, staff receives a
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
