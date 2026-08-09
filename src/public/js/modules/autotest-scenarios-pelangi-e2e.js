/**
 * @fileoverview Pelangi Capsule Hostel E2E guest-journey test scenarios
 * @module autotest-scenarios-pelangi-e2e
 * 50 scenarios across PRICING, AVAILABILITY, BOOKING, CHECKIN, CHECKOUT,
 * CANCEL, AMENITY, LOCATION, POLICY — created July 2026 hardening session.
 */

export const PELANGI_E2E_SCENARIOS = [
  // ══════════════════════════════════════════════════════════════
  // PRICING (8)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-01-pricing-weekday',
    name: 'E2E: Weekday price inquiry',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How much is a bed on a weekday?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM', '30'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-02-pricing-weekend',
    name: 'E2E: Weekend price inquiry',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What is the price for a Saturday night?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM', '35'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-03-pricing-monthly',
    name: 'E2E: Monthly rate inquiry',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Do you have monthly rates for long stays?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['monthly', 'month', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-04-pricing-tourism-tax',
    name: 'E2E: Tourism tax inquiry',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Is there a tourism tax? How much?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM 10', 'tourism tax', 'tax'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-05-pricing-total-2nights',
    name: 'E2E: 2-night total cost Friday start',
    category: 'PELANGI_E2E',
    messages: [{ text: '2 nights starting this Friday, total cost?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-06-pricing-payment-methods',
    name: 'E2E: Payment methods',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What payment methods do you accept?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['cash', 'transfer', 'payment'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-07-pricing-deposit',
    name: 'E2E: Deposit to book',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Do I need to pay a deposit to book?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['deposit', 'payment'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-08-pricing-deck-difference',
    name: 'E2E: Lower vs upper deck price',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Is lower deck cheaper than upper deck?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['lower', 'upper', 'deck', 'RM'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // AVAILABILITY (7)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-09-avail-today',
    name: 'E2E: Beds available today',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Any beds available today?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'check', 'room', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-10-avail-tonight',
    name: 'E2E: Anything for tonight',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Do you have anything for tonight?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'check', 'tonight', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-11-avail-specific-date',
    name: 'E2E: Room on specific date',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Is there a room on 25 July 2026?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'check', 'July', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-12-avail-this-saturday',
    name: 'E2E: Beds this Saturday',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Do you have beds available this Saturday?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'check', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-13-avail-3nights-fri-mon',
    name: 'E2E: 3 consecutive nights Fri-Mon',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I need 3 consecutive nights from Friday to Monday' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'check', 'night', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-14-avail-fully-booked',
    name: 'E2E: Fully booked this weekend',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Are you fully booked this weekend?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'booked', 'weekend', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-15-avail-how-many',
    name: 'E2E: How many beds available',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How many beds do you still have available?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['available', 'bed', 'capsule'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // BOOKING (8)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-16-book-2pax',
    name: 'E2E: Book for 2 people',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I want to book a capsule for 2 people' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['book', 'name', 'date', 'guest'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-17-book-solo-1night',
    name: 'E2E: Book 1 night solo',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Book for 1 night for just me' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['book', 'name', 'date', 'night'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-18-book-fri-to-mon',
    name: 'E2E: Book Fri-Mon 3 nights',
    category: 'PELANGI_E2E',
    messages: [{ text: "I'd like to stay from Friday to Monday, 3 nights" }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['book', 'date', 'name', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-19-book-walkin',
    name: 'E2E: Walk-in without booking',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I just walk in without booking?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['walk', 'book', 'available', 'reservation'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-20-book-group4',
    name: 'E2E: Group of 4 friends',
    category: 'PELANGI_E2E',
    messages: [{ text: 'We have 4 friends coming, can we book together?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['book', 'group', '4', 'capsule'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-21-book-confirmation',
    name: 'E2E: What do I receive after booking',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What will I receive after booking?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['confirm', 'email', 'WhatsApp', 'reservation'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-22-book-online',
    name: 'E2E: How to book online',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How do I book a capsule online?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['book', '/book', 'WhatsApp', 'website'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-23-book-next-week',
    name: 'E2E: Reservation next week',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I want to make a reservation for next week' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['book', 'name', 'date', 'reservation'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // CHECKIN (6)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-24-checkin-time',
    name: 'E2E: Check-in time',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What time is check-in?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['2', 'PM', '14:00'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-25-checkin-self',
    name: 'E2E: How self check-in works',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How does self check-in work?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['self', 'check', 'code', 'door'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-26-checkin-no-reception',
    name: 'E2E: Enter if no one at reception',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How do I get in if no one is at reception?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['door', 'code', 'self', '1270'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-27-checkin-early-noon',
    name: 'E2E: Can I check in at noon',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I check in at noon, 12pm?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['2 PM', 'early', 'check'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-28-checkin-id-required',
    name: 'E2E: IC or passport required',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What IC or passport do I need to show?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['IC', 'passport', 'document', 'ID'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-29-checkin-arrived',
    name: 'E2E: Arrived at hostel check me in',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I have arrived at the hostel, please check me in' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['check', 'name', 'welcome', 'unit'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // CHECKOUT (5)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-30-checkout-time',
    name: 'E2E: Check-out time',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What time do I need to check out?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['12', 'noon', 'PM', 'check'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-31-checkout-late-3pm',
    name: 'E2E: Late check-out at 3pm',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I check out at 3pm?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['late', '3', 'PM', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-32-checkout-late-fee',
    name: 'E2E: Late check-out fee',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How much is it if I check out late?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['RM', 'late', 'hour'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-33-checkout-extend',
    name: 'E2E: Extend stay one more night',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I want to stay one more night, how do I extend?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['extend', 'night', 'staff', 'RM'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-34-checkout-now',
    name: 'E2E: Check out now',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I want to check out now' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['check', 'checkout', 'staff'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // CANCEL (5) — regression guard on #35
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-35-cancel-booking',
    name: 'E2E: Cancel booking (regression guard)',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I want to cancel my booking' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['cancel', 'confirm', 'booking'], critical: true },
      { type: 'not_contains', values: ['check-in date', 'what date'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-36-cancel-2days-before',
    name: 'E2E: Cancel 2 days before',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I cancel 2 days before check-in?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['cancel', 'refund', 'policy'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-37-cancel-full-refund',
    name: 'E2E: Full refund on cancel',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Will I get a full refund if I cancel?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['refund', 'cancel', 'policy'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-38-cancel-change-date',
    name: 'E2E: Change check-in date',
    category: 'PELANGI_E2E',
    messages: [{ text: 'I want to change my check-in date' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['change', 'modify', 'date', 'staff'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-39-cancel-noshow',
    name: 'E2E: No-show policy',
    category: 'PELANGI_E2E',
    messages: [{ text: "What happens if I can't make it, no-show?" }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['cancel', 'no-show', 'policy', 'contact'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // AMENITY (5) — regression guard on #41
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-40-amenity-wifi',
    name: 'E2E: WiFi password',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What is the WiFi password?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['WiFi', 'password', 'ilovestaycapsule'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-41-amenity-towel',
    name: 'E2E: Extra towel (regression guard)',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I get an extra towel please?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['towel', 'amenity', 'staff'], critical: true },
      { type: 'not_contains', values: ['sliding door', 'premium mattress'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-42-amenity-locker',
    name: 'E2E: Locker for luggage',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Is there a locker for my luggage?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['locker', 'storage', 'luggage'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-43-amenity-aircon',
    name: 'E2E: Air conditioning in capsule',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Is there air conditioning in the capsule?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['aircon', 'air', 'fan', 'cooling'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-44-amenity-charging',
    name: 'E2E: Phone charging point',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Where can I charge my phone?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['charge', 'power', 'USB', 'socket'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // LOCATION (4)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-45-location-address',
    name: 'E2E: Full address',
    category: 'PELANGI_E2E',
    messages: [{ text: 'What is your full address?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['Jalan', 'Pelangi', 'Johor', 'address'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-46-location-from-jbsentral',
    name: 'E2E: Directions from JB Sentral',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How do I get there from JB Sentral?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['JB', 'Sentral', 'taxi', 'Grab', 'bus', 'walk'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-47-location-parking',
    name: 'E2E: Parking nearby',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Is there parking near your hostel?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['park', 'parking', 'nearby', 'car'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-48-location-from-singapore',
    name: 'E2E: Travel from Singapore',
    category: 'PELANGI_E2E',
    messages: [{ text: 'How to travel from Singapore to your hostel?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['Singapore', 'bus', 'taxi', 'Larkin'], critical: true }
    ]}]
  },
  // ══════════════════════════════════════════════════════════════
  // POLICY (2)
  // ══════════════════════════════════════════════════════════════
  {
    id: 'pelangi-e2e-49-policy-smoking',
    name: 'E2E: Smoking policy',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I smoke inside the capsule?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['smoke', 'smoking', 'no smoking', 'outside'], critical: true }
    ]}]
  },
  {
    id: 'pelangi-e2e-50-policy-outside-food',
    name: 'E2E: Outside food policy',
    category: 'PELANGI_E2E',
    messages: [{ text: 'Can I bring outside food into the hostel?' }],
    validate: [{ turn: 0, rules: [
      { type: 'not_empty', critical: true },
      { type: 'contains_any', values: ['food', 'allowed', 'welcome', 'outside'], critical: true }
    ]}]
  }
];
