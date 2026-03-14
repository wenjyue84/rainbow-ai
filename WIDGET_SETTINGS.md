# Rainbow AI Widget Settings

Centralized reference for all active Rainbow AI widget installations across web apps.

---

## Active Installations

### 1. Makan Moments Cafe — Customer Widget
| Setting | Value |
|---------|-------|
| **Project** | `fnb-online-ordering` |
| **Profile** | `makan-moments` |
| **Color** | `#6366f1` (indigo) |
| **Label** | `Chat with us` |
| **Subtitle** | `Ask about our menu, hours, or specials!` |
| **WhatsApp** | (not set) |
| **Position** | `right` |
| **Integration** | `widget.js` snippet in public layout |
| **File** | `src/app/layout.tsx` |
| **Status** | ✅ Active |

---

### 2. Makan Moments Cafe — Staff Assistant (Admin)
| Setting | Value |
|---------|-------|
| **Project** | `fnb-online-ordering` |
| **Profile** | `makan-moments-admin` |
| **Color** | `#b45309` (amber — matches admin theme-color) |
| **Label** | `Staff Assistant` |
| **Subtitle** | `Hi! How can I help you today?` |
| **WhatsApp** | (not set) |
| **Position** | `right` |
| **Integration** | `window.__rbw` + Next.js `<Script strategy="afterInteractive">` |
| **File** | `src/app/admin/layout.tsx` |
| **Status** | ✅ Active |

**Note:** Uses `window.__rbw` config pattern (instead of `data-*` attributes) because Next.js `strategy="afterInteractive"` loads scripts after hydration where `document.currentScript` is null.

---

### 3. Pelangi Capsule Hostel — Customer Widget
| Setting | Value |
|---------|-------|
| **Project** | `pelangi-website` |
| **Profile** | `pelangi` |
| **Color** | `#a68b64` (warm brown — brand color) |
| **Label** | `Chat with us` |
| **Subtitle** | `Questions about our rooms or booking?` |
| **WhatsApp** | `60127088789` |
| **Position** | `right` |
| **Integration** | `ChatWidget.tsx` injects `widget.js` via `useEffect` after 10s delay |
| **File** | `site/src/components/ChatWidget.tsx` |
| **Status** | ✅ Active |

**Note:** 10-second delay matches the previous FAQ bot behavior. Widget is loaded dynamically to avoid SSR issues. `DynamicComponents.tsx` stays unchanged — still imports ChatWidget by path.

**Vercel env required:** `NEXT_PUBLIC_RAINBOW_AI_URL=https://admin.pelangicapsulehostel.com`

---

### 4. PMS2 — Staff Assistant (Pelangi Capsule)
| Setting | Value |
|---------|-------|
| **Project** | `PMS2` (pms-capsule.vercel.app) |
| **Profile** | `pms-capsule` |
| **Color** | (default) |
| **Integration** | React iframe component (ChatbotWidget.tsx) |
| **Status** | ✅ Active (React iframe, not widget.js) |

**Note:** Uses a React iframe component rather than widget.js. AI behavior is centralized (iframe loads from Lightsail). Can be migrated to widget.js in a future pass for consistency.

---

## Profiles Reference

| Profile ID | Name | KB Dir | Data Dir | Used By |
|------------|------|--------|----------|---------|
| `pelangi` | Pelangi Capsule Hostel | `.rainbow-kb` | `src/assistant/data` | pelangi-website, PMS2 iframe |
| `southern` | Southern Homestay | `.rainbow-kb-southern` | `src/assistant/data-southern` | — |
| `makan-moments` | Makan Moments Cafe | `.rainbow-kb-makan` | `src/assistant/data-makan` | fnb-online-ordering (public) |
| `makan-moments-admin` | Makan Moments — Staff Assistant | `.rainbow-kb-makan` | `src/assistant/data-makan` | fnb-online-ordering (admin) |
| `pms-capsule` | Pelangi Capsule — Staff Assistant | `.rainbow-kb-pms-capsule` | `src/assistant/data-pms-capsule` | PMS2 |
| `pms-southern` | Southern Homestay — Staff Assistant | `.rainbow-kb-pms-southern` | `src/assistant/data-pms-southern` | — |

---

## widget.js Configuration Patterns

### Pattern A: Inline `data-*` attributes (synchronous)
```html
<script src="https://admin.pelangicapsulehostel.com/widget.js"
  data-profile="pelangi"
  data-color="#a68b64"
  data-label="Chat with us"
  data-whatsapp="60127088789">
</script>
```
Use when: plain HTML sites, or Next.js with `strategy="beforeInteractive"`.

### Pattern B: `window.__rbw` + async script (deferred/dynamic)
```html
<!-- 1. Push config first (inline script, no async) -->
<script>
  window.__rbw = {
    profile:  'pelangi',
    color:    'a68b64',   // '#' prefix optional — widget normalizes it
    label:    'Chat with us',
    subtitle: 'Questions about our rooms or booking?',
    whatsapp: '60127088789',
    position: 'right',
  };
</script>

<!-- 2. Load widget.js async/deferred -->
<script src="https://admin.pelangicapsulehostel.com/widget.js" async></script>
```
Use when: Next.js `strategy="afterInteractive"`, or dynamic `document.createElement('script')`.

### Pattern C: Dynamic injection via `useEffect` (React/Next.js)
```tsx
useEffect(() => {
  (window as any).__rbw = { profile: 'pelangi', color: 'a68b64', ... };
  if (document.getElementById('_rbw-script')) return;
  const s = document.createElement('script');
  s.id = '_rbw-script';
  s.src = 'https://admin.pelangicapsulehostel.com/widget.js';
  s.async = true;
  document.body.appendChild(s);
}, []);
```
Use when: delayed injection (timed show), React components without SSR.

---

## Architecture: Why widget.js (Centralized)

widget.js is served **from Rainbow AI (Lightsail)**. Update widget UI once → all sites update automatically. No per-app redeployment needed for widget UI changes.

AI behavior (KB, prompts, profiles) is also centralized in Rainbow AI. Both the embedding and the AI logic live in one place.

### Future: MCP Architecture
- Rainbow AI (Lightsail) → MCP **client**
- `fnb-online-ordering`, PMS2 → MCP **servers** exposing domain tools (`get_menu`, `check_availability`, etc.)
- widget.js centralization is the foundation for this architecture

---

## Environment Variables

| Project | Variable | Value |
|---------|----------|-------|
| `fnb-online-ordering` | `NEXT_PUBLIC_RAINBOW_AI_URL` | `https://admin.pelangicapsulehostel.com` |
| `pelangi-website` | `NEXT_PUBLIC_RAINBOW_AI_URL` | `https://admin.pelangicapsulehostel.com` |

Add these to Vercel project settings for each app. Default fallback is `http://localhost:3002` for local dev.
