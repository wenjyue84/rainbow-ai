# WhatsApp Transport Layer — Architecture & Migration Plan

**Status:** Current
**Last Updated:** 2026-03-16
**Relevant Story:** US-1029 — On-Premises API Sunset Audit

---

## 1. Audit Summary — On-Premises API

The WhatsApp On-Premises API was officially sunset on **October 23, 2025**. This document records the audit result and the current transport architecture.

### Audit Findings

A full codebase audit was performed on 2026-03-16. No references to the WhatsApp On-Premises API were found:

| Search Pattern | Result |
|---|---|
| On-premises Docker image references | ✅ None found |
| `v1/messages` or `v1/contacts` endpoints | ✅ None found |
| On-premises endpoint patterns (`localhost:9090`, port 8080 for WA) | ✅ None found |
| `wacore` or `whatsapp-client` Docker references | ✅ None found |
| `registry.docker.com/whatsapp/whatsapp*` image references | ✅ None found |

**Conclusion:** Rainbow AI was never built on the WhatsApp On-Premises API. The on-premises sunset does not affect this system.

---

## 2. Current Transport: Baileys (Direct WebSocket)

Rainbow AI uses **[Baileys](https://github.com/WhiskeySockets/Baileys)**, a reverse-engineered Node.js library that connects directly to WhatsApp's WebSocket servers.

### How It Works

```
WhatsApp User
     │
     ▼
WhatsApp Servers (WebSocket)
     │  ← Baileys maintains persistent WebSocket connection
     ▼
src/lib/whatsapp/
├── instance.ts    ← Manages one WhatsApp connection
├── manager.ts     ← Multi-instance orchestration
├── lid-mapper.ts  ← LID→phone JID resolution
└── index.ts       ← Public API
```

### Capabilities

| Feature | Supported |
|---|---|
| Text messages (send/receive) | ✅ |
| Media messages (images, documents) | ✅ |
| Typing indicators | ✅ |
| Multi-instance (Pelangi + Southern) | ✅ |
| Message status (delivered/read) | ✅ |
| Template messages | ❌ (requires Cloud API) |
| Interactive buttons | ❌ (requires Cloud API) |
| WhatsApp Flows | ❌ (requires Cloud API) |

### Terms of Service Risk

**⚠️ IMPORTANT: Baileys is not an official WhatsApp integration.**

| Risk | Detail |
|---|---|
| **Account ban risk** | WhatsApp may ban phone numbers detected using unofficial clients |
| **No official support** | Baileys is a reverse-engineered client; behaviour may break after WhatsApp protocol updates |
| **Meta ToS violation** | Use of unofficial clients violates WhatsApp's Terms of Service |
| **No template access** | Cannot send approved template messages required for business-initiated conversations |
| **Session instability** | Auth tokens can expire or be invalidated by WhatsApp, requiring re-scan of QR code |

**Operational workarounds in place:**
- PM2 auto-restart on crash (max 10 restarts)
- `src/lib/baileys-supervisor.ts` monitors connection health
- Admin panel shows live QR code for re-authentication

---

## 3. Official Cloud API — What It Provides

The **WhatsApp Business Cloud API** (hosted by Meta) is the official integration path for businesses.

### Comparison

| Factor | Baileys (Current) | Cloud API (Target) |
|---|---|---|
| **Hosting** | Phone number on device | Meta's servers |
| **ToS compliance** | ❌ Violation | ✅ Compliant |
| **Template messages** | ❌ Not supported | ✅ Full support |
| **Interactive messages** | ❌ Not supported | ✅ Buttons, lists, flows |
| **WhatsApp Flows** | ❌ Not supported | ✅ Full support |
| **Webhook reliability** | Best-effort | Meta-guaranteed delivery |
| **Phone number type** | Personal number | Business number (WABA) |
| **Cost** | Free (infra only) | Per-message pricing applies |
| **Setup complexity** | Low (QR scan) | High (BSP/direct Meta account) |

---

## 4. Cloud API Migration Plan

### Prerequisites (Before Starting)

1. **Business Verification** — Meta requires Facebook Business Manager verification (1-3 weeks)
2. **WhatsApp Business Account (WABA)** — Apply via Meta Business Suite or a BSP
3. **Phone Number** — Dedicated business phone number (cannot be an existing WhatsApp number)
4. **BSP or Direct Access** — Either register as a BSP or use a provider (Twilio, Vonage, MessageBird)

### Migration Phases

#### Phase 1: Parallel Setup (Effort: 1-2 weeks)
- Register WABA and obtain phone number
- Configure webhook endpoint (`POST /webhook/whatsapp`)
- Create Cloud API adapter implementing the same `sendMessage` interface as Baileys
- Test webhook verification and message receipt

#### Phase 2: Adapter Implementation (Effort: 2-3 weeks)
```typescript
// Target interface (already satisfied by Baileys)
interface WhatsAppTransport {
  sendMessage(phone: string, text: string): Promise<void>;
  sendMedia(phone: string, media: MediaPayload): Promise<void>;
  sendTypingIndicator(phone: string): Promise<void>;
  onMessage(handler: MessageHandler): void;
}

// New Cloud API implementation
class CloudApiTransport implements WhatsAppTransport {
  private readonly baseUrl = 'https://graph.facebook.com/v21.0';
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  // ...
}
```

#### Phase 3: Feature Parity (Effort: 1-2 weeks)
- Implement template message sending (required for business-initiated conversations)
- Add interactive message support (buttons, quick replies)
- Port multi-instance support (one WABA phone number per property)

#### Phase 4: Traffic Migration (Effort: 1 week)
- Deploy Cloud API transport alongside Baileys (feature flag: `USE_CLOUD_API=true`)
- Route new conversations through Cloud API, let existing Baileys sessions drain
- Monitor error rates and response times
- Cut over fully when stable

#### Phase 5: Baileys Decommission (Effort: 0.5 week)
- Remove `src/lib/whatsapp/` directory
- Remove `whatsapp-auth/` and `whatsapp-auth-southern/` directories
- Update CLAUDE.md and architecture docs

### Effort Estimate

| Phase | Duration | Risk |
|---|---|---|
| Phase 1: Parallel Setup | 1-2 weeks | Medium — BSP onboarding can be slow |
| Phase 2: Adapter | 2-3 weeks | Low — well-defined interface |
| Phase 3: Feature Parity | 1-2 weeks | Low |
| Phase 4: Traffic Migration | 1 week | Medium — production traffic cut-over |
| Phase 5: Decommission | 0.5 week | Low |
| **Total** | **5.5-8.5 weeks** | |

### Key Files to Modify

| File | Change |
|---|---|
| `src/lib/whatsapp/` | Replace with `src/lib/cloud-api/` |
| `src/lib/baileys-client.ts` | Replace exports to point to Cloud API adapter |
| `src/index.ts` | Replace `initBaileys()` with `initCloudApi()` |
| `src/routes/admin/whatsapp.ts` | Update QR code routes to webhook verification |
| `ecosystem.config.cjs` | Remove WhatsApp auth volume mounts |

### Cost Implications

Cloud API uses Meta's [conversation-based pricing](https://developers.facebook.com/docs/whatsapp/pricing):
- **Service conversations** (guest replies within 24h) — free up to 1,000/month
- **Utility conversations** (booking confirmations) — ~$0.004/conversation (MY)
- **Marketing conversations** (promotions) — ~$0.011/conversation (MY)

At current volume (~200 conversations/month across both properties), estimated cost: **< RM 20/month**.

---

## 5. Interim Risk Mitigation (Current State)

Until Cloud API migration is completed, the following measures reduce Baileys operational risk:

| Measure | Implementation |
|---|---|
| Auto-reconnect | PM2 `max_restarts: 10`, `restart_delay: 5000` |
| Connection monitoring | `src/lib/baileys-supervisor.ts` polls every 30s |
| Admin QR re-auth | `/admin/rainbow` dashboard shows live QR code |
| Session backup | `whatsapp-auth/` committed to separate encrypted backup |
| Rate limiting | `src/middleware/rate-limit.ts` prevents sending spikes that trigger bans |

---

## 6. Related Files

| File | Purpose |
|---|---|
| `src/lib/whatsapp/instance.ts` | WhatsApp connection lifecycle |
| `src/lib/whatsapp/manager.ts` | Multi-instance orchestration |
| `src/lib/baileys-supervisor.ts` | Connection health monitor |
| `src/lib/mm-lite.ts` | MM Lite API (uses Cloud API for bulk marketing — separate from core Baileys transport) |
| `ecosystem.config.cjs` | PM2 process config |
| `whatsapp-auth/` | Baileys auth state (Pelangi) |
| `whatsapp-auth-southern/` | Baileys auth state (Southern) |
