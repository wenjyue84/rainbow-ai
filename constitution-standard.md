# Rainbow AI — Spiral Constitution
## Pre-Ordering Focus: Makan Moments Cafe

### Core Rule: Every Story Must Be Visible & Felt
Every user story MUST produce a change that:
- A customer can **see or feel** directly in their WhatsApp chat conversation, OR
- An admin can **see or act on** in the kitchen notification or admin dashboard

Reject or deprioritize: internal refactors, logging improvements, schema changes,
or infrastructure work UNLESS they directly unblock a visible customer/admin feature.

---

### Customer-Side Visible Improvements (WhatsApp Chat)

Stories that improve these MUST be prioritised:

1. **Menu browsing experience** — formatted menu cards with item name, price, and description in WhatsApp messages; emoji or bold text for visual hierarchy
2. **Order confirmation UX** — after placing an order, the AI waiter MUST send a clear summary: items, quantities, estimated total, pickup/arrival time
3. **Multi-item cart feedback** — as customers add items, show running cart state ("You have: 1x Nasi Lemak, 2x Teh Tarik — add more or confirm?")
4. **Order disambiguation** — when customer is vague ("I want the usual"), ask clear follow-up questions, not generic "I don't understand"
5. **Intent accuracy** — if the AI misunderstands an order intent, show a friendly correction prompt instead of silent failure
6. **Order status updates** — send proactive WhatsApp messages when order status changes (confirmed → preparing → ready)
7. **Language handling** — support Malay/English mix naturally (Manglish); don't break on "satu teh o ais kurang manis"

### Admin-Side Visible Improvements

Stories that improve these MUST be prioritised:

1. **Kitchen notification clarity** — notifications must show: table/customer name, order items, quantities, special requests, timestamp
2. **Order dashboard readability** — orders listed with clear status indicators (pending, confirmed, preparing, done)
3. **Error visibility** — if the AI fails to parse an order, admin sees an alert, not a silent drop
4. **Order management actions** — admin can confirm, reject, or update order status with one tap/click

---

### What Is Out of Scope (Reject These Stories)
- Generic code quality improvements with no user-visible output
- Abstract "improve architecture" stories
- Stories touching only test files or config files with no UX change
- Performance optimisations under 100ms that users cannot perceive
- Stories that duplicate existing functionality without improvement

---

### Acceptance Criteria Standards
Every story's acceptance criteria MUST include at least one of:
- "Customer sees [X] in WhatsApp chat"
- "Admin sees [X] in dashboard/notification"
- "The order confirmation message shows [X]"
- "When customer types [X], the bot responds with [Y]"
