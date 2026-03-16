# WhatsApp Flows — Web Companion Testing Checklist

> **US-936**: Validate WhatsApp Flows rendering on WhatsApp Web (desktop companion).
> **Background**: Meta enabled WhatsApp Web companion support for Flows in December 2025.
> The same Flow JSON renders on both mobile and desktop — no separate web-specific Flow needed.

## Pre-requisites

- [ ] WhatsApp Web open at `web.whatsapp.com` with test WABA phone number
- [ ] Test phone paired with WhatsApp Web session
- [ ] Flow data-exchange endpoints deployed and accessible
- [ ] All flow health checks returning `{ data: { status: 'active' } }`

## Browser Matrix

| Browser | Desktop OS | Status |
|---------|-----------|--------|
| Chrome (latest) | Windows/macOS | Required |
| Firefox (latest) | Windows/macOS | Required |
| Edge (latest) | Windows | Optional |
| Safari (latest) | macOS | Optional |

---

## Flow 1: Reservation Flow (`reservation-flow.json`)

### Screen: RESERVATION_DATES
- [ ] DatePicker components render correctly on Chrome desktop
- [ ] DatePicker components render correctly on Firefox desktop
- [ ] Date selection works with mouse click (not just touch)
- [ ] Min/max date constraints enforced
- [ ] Error messages display without overflow on wider viewport
- [ ] "Next" footer button is clickable and responsive

### Screen: RESERVATION_DETAILS
- [ ] **ImageCarousel renders and is navigable on Chrome** (arrow keys / click navigation)
- [ ] **ImageCarousel renders and is navigable on Firefox** (arrow keys / click navigation)
- [ ] ImageCarousel images display at 4:3 aspect ratio without distortion
- [ ] ImageCarousel fallback TextBody appears when images unavailable
- [ ] Dropdown (Room/Bed Type) opens and is selectable with mouse
- [ ] Number input for guest count accepts keyboard input
- [ ] TextArea for special requests allows 600-character input
- [ ] Form layout does not break at desktop viewport widths

### Screen: RESERVATION_CONFIRM
- [ ] Booking confirmation text renders fully (no truncation)
- [ ] Booking reference is displayed correctly
- [ ] "Done" button triggers `complete` action
- [ ] **Flow completion callback fires regardless of mobile vs web origin**

### Data Exchange Verification
- [ ] `POST /whatsapp-flows/data-exchange` responds identically from mobile and web
- [ ] INIT action returns same screen/data structure on both platforms
- [ ] check_availability action processes correctly from web companion
- [ ] submit_reservation action creates booking from web companion
- [ ] WhatsApp confirmation message sent to guest regardless of platform

---

## Flow 2: Guest Digital Check-in Flow (check-in)

### Screen: CHECKIN_WELCOME
- [ ] Welcome screen renders on Chrome desktop
- [ ] Welcome screen renders on Firefox desktop
- [ ] Pre-filled booking data appears correctly

### Screen: PERSONAL_DETAILS
- [ ] TextInput for guest name accepts desktop keyboard input
- [ ] TextInput for nationality works correctly
- [ ] Validation error messages display without layout issues

### Screen: ID_VERIFICATION
- [ ] IC/passport input accepts desktop keyboard alphanumeric input
- [ ] Validation feedback displays inline
- [ ] BACK navigation returns to PERSONAL_DETAILS

### Screen: TERMS_AND_CONDITIONS
- [ ] Terms text is fully scrollable on desktop viewport
- [ ] OptIn/checkbox for acceptance is clickable with mouse
- [ ] Terms text does not overflow container on wider viewports

### Screen: CHECKIN_COMPLETE
- [ ] Confirmation details render fully
- [ ] Door password and WiFi info are visible
- [ ] "Done" button completes the flow

### Data Exchange Verification
- [ ] `POST /whatsapp-flows/checkin-exchange` works from web companion
- [ ] INIT pre-fills booking data the same way from mobile and web
- [ ] Check-in persists to `wa_flow_checkins` table from web
- [ ] Admin notification fires regardless of platform origin

---

## Flow 3: Menu Ordering Flow (`menu-flow.json`)

### Screen: MENU_BROWSE
- [ ] **ImageCarousel renders menu images on Chrome** (16:9 aspect ratio)
- [ ] **ImageCarousel renders menu images on Firefox** (16:9 aspect ratio)
- [ ] ImageCarousel navigation works with mouse/keyboard on desktop
- [ ] ImageCarousel fallback text appears when images unavailable
- [ ] Dropdown for menu item selection works with mouse click
- [ ] Number input for quantity accepts keyboard input

### Screen: ORDER_DETAILS
- [ ] Order summary text renders fully
- [ ] Total amount displays correctly
- [ ] TextArea for special notes allows 300-character input
- [ ] "Place Order" button is responsive

### Screen: ORDER_CONFIRM
- [ ] Order reference displays correctly
- [ ] Order summary is not truncated
- [ ] "Done" button triggers `complete` action
- [ ] **Flow completion callback fires from web companion**

### Data Exchange Verification
- [ ] `POST /whatsapp-flows/menu-exchange` responds identically from web
- [ ] add_to_order accumulates items correctly from web session
- [ ] submit_order creates order from web companion
- [ ] WhatsApp confirmation sent regardless of originating platform

---

## Cross-cutting Checks

### Layout & Viewport
- [ ] No horizontal scrollbar appears on any screen at desktop widths
- [ ] All screens use SingleColumnLayout (adapts to both mobile and desktop)
- [ ] No fixed pixel widths in any flow JSON component
- [ ] Text content wraps naturally at wider viewports

### ImageCarousel (All Flows)
- [ ] Carousel navigation arrows visible on desktop
- [ ] Carousel images maintain aspect ratio on desktop
- [ ] Carousel swipe gesture (mouse drag) works on desktop
- [ ] Alt-text accessible via screen readers on desktop

### Input Components
- [ ] Tab navigation works between form fields on desktop
- [ ] Enter key submits forms where expected
- [ ] Keyboard shortcuts don't conflict with WhatsApp Web shortcuts

### Encryption & Security
- [ ] Encrypted data exchange works identically on mobile and web
- [ ] Flow token validation passes from web companion
- [ ] PING health checks respond from both platforms

---

## Automated Test Coverage

Run these tests to validate web compatibility programmatically:

```bash
npx vitest run src/assistant/__tests__/whatsapp-flows-web-compat.test.ts
```

Tests verify:
- All flow JSONs pass web compat structural validation
- No fixed pixel widths in any flow definition
- All screens use SingleColumnLayout
- ImageCarousel components use standard aspect ratios
- Endpoint responses contain no platform-specific fields
- Terminal screens use `complete` action
- Flow version >= 6.0 (required for web companion support)
- Routing model references only existing screens

---

## Sign-off

| Flow | Tester | Date | Chrome | Firefox | Notes |
|------|--------|------|--------|---------|-------|
| Reservation | | | | | |
| Check-in | | | | | |
| Menu Order | | | | | |

**Approved by:** _______________  **Date:** _______________
