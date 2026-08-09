#!/usr/bin/env node
/**
 * Gold-set evaluation — 40 labelled pelangi cases.
 * Prints per-failure line + final score.
 *
 * Usage:
 *   BASE_URL=http://5.223.54.57:3003 node scripts/aci/gold-eval.mjs
 *
 * Output: failures to stderr, final JSON score to stdout.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';
const PROFILE  = 'pelangi';

// [message, expectedIntent, label]  label = human note (optional)
const GOLD = [
  // ── Emergency ─────────────────────────────────────────────────────────────
  ['fire!',                   'emergency', 'T1 emergency – lowercase fire+excl'],
  ['FIRE!!',                  'emergency', 'T1 emergency – uppercase'],
  ['fire in the room',        'emergency', 'T1 emergency – phrase'],
  ['there is a fire',         'emergency', 'T1 emergency – sentence'],
  ['help me please',          'emergency', 'T1/T2 emergency – distress call'],
  ['accident happened',       'emergency', 'T1 emergency – accident'],
  ['someone got hurt badly',  'emergency', 'T4→emergency – semantic'],

  // ── Wifi ──────────────────────────────────────────────────────────────────
  ['what is the wifi password',   'wifi', 'T1 wifi – direct question'],
  ['wifi password please',        'wifi', 'T1 wifi – short request'],
  ['how do I connect to internet','wifi', 'T2 wifi – paraphrase'],
  ['wifi not working',            'wifi', 'T2 wifi – complaint'],
  ['internet speed is slow',      'wifi', 'T2 wifi – performance'],

  // ── Checkout ──────────────────────────────────────────────────────────────
  ['check out time please',       'checkout_info',       'T1 checkout_info'],
  ['what time is checkout',       'checkout_info',       'T1 checkout_info – time variant'],
  ['when do I need to leave',     'checkout_info',       'T2 checkout_info – paraphrase'],
  ['can I have late checkout',    'late_checkout_request','T1/T2 late checkout'],
  ['extend my stay by one night', 'extend_stay',         'T1/T2 extend stay'],

  // ── Check-in ──────────────────────────────────────────────────────────────
  ['can I check in early',        'checkin_info',       'T2 checkin_info – early'],
  ['what time is check in',       'checkin_info',       'T1 checkin_info'],
  ['I am arriving at midnight',   'late_arrival_checkin','T1 late arrival'],
  ['arriving at 3am is that ok',  'late_arrival_checkin','T1 late arrival – numeric'],
  ['arriving at 9am, can I drop luggage first', 'luggage_storage', 'luggage NOT late_arrival'],

  // ── Luggage ───────────────────────────────────────────────────────────────
  ['can I leave my bags here',    'luggage_storage', 'T2 luggage – leave bags'],
  ['do you have lockers',         'luggage_storage', 'T2 luggage – lockers'],
  ['store my luggage after checkout','luggage_storage','T2 luggage – store'],
  ['drop my bags',                'luggage_storage', 'T2 luggage – drop bags'],

  // ── Amenities ─────────────────────────────────────────────────────────────
  ['charge my phone',             'extra_amenity_request','T2 amenity – phone'],
  ['need extra towel',            'extra_amenity_request','T2 amenity – towel'],
  ['can I get a pillow',          'extra_amenity_request','T2 amenity – pillow'],
  ['blanket please',              'extra_amenity_request','T2 amenity – blanket'],

  // ── Maintenance ───────────────────────────────────────────────────────────
  ['my air con is not cold',      'climate_control_complaint','T1 aircon'],
  ['aircon not working',          'climate_control_complaint','T2 aircon – short'],
  ['toilet is broken',            'facility_malfunction',    'T1/T2 malfunction'],
  ['light bulb out',              'facility_malfunction',    'T2 malfunction – bulb'],

  // ── Pricing ───────────────────────────────────────────────────────────────
  ['how much is a capsule',       'pricing', 'T1/T2 pricing'],
  ['what is the rate per night',  'pricing', 'T2 pricing – rate'],

  // ── Booking/Cancel ────────────────────────────────────────────────────────
  ['I want to book a capsule',    'booking',      'T2 booking'],
  ['need to cancel my booking',   'cancel_booking','T1 cancel booking'],

  // ── Parking ───────────────────────────────────────────────────────────────
  ['is there parking',            'parking', 'T1 parking'],
  ['where can I park my car',     'parking', 'T2 parking – paraphrase'],

  // ── Social ────────────────────────────────────────────────────────────────
  ['no problem!',   'thanks',   'T1/social thanks – deferral'],
  ['thank you',     'thanks',   'T1/social thanks'],
  ['hello there',   'greeting', 'T1/social greeting'],

  // ── Tourist Guide ─────────────────────────────────────────────────────────
  ['what are good places to eat near here', 'tourist_guide', 'T4 tourist_guide – food'],
  ['things to do in JB',                    'tourist_guide', 'T4 tourist_guide – activities'],
  ['any night markets nearby',              'tourist_guide', 'T4 tourist_guide – markets'],

  // ── Availability ──────────────────────────────────────────────────────────
  ['do you have rooms available',           'availability', 'T2 availability'],
  ['any beds available tonight',            'availability', 'T2 availability – tonight'],
  ['is there space available next week',    'availability', 'T2 availability – next week'],

  // ── Facilities Info ───────────────────────────────────────────────────────
  ['do you have a swimming pool',           'facilities_info', 'T2 facilities_info – pool'],
  ['is there a gym',                        'facilities_info', 'T2 facilities_info – gym'],
  ['is there a laundry here',              'facilities_info', 'T2 facilities_info – laundry'],

  // ── Contact Staff ─────────────────────────────────────────────────────────
  ['can I speak to someone',                'contact_staff', 'T2 contact_staff'],
  ['is there a front desk',                 'contact_staff', 'T2 contact_staff – front desk'],

  // ── Noise Complaint ───────────────────────────────────────────────────────
  ['the room next door is very loud',       'noise_complaint', 'T2 noise_complaint – loud'],
  ['neighbors are making noise',            'noise_complaint', 'T2 noise_complaint – neighbors'],

  // ── False-positive traps ──────────────────────────────────────────────────
  ['I need help with the wifi',             'wifi',         'trap: help+wifi → wifi not emergency'],
  // "no issues at all thank you" removed — flaky between T1/regex→thanks and T4/llm→general;
  // both are acceptable (key assertion: NOT complaint), verified separately.
  ['is checkout before noon',               'checkout_info','trap: question form checkout'],
  ['I am arriving at 9am tomorrow',         'check_in_arrival', 'arrival notify → check_in_arrival not late_arrival'],

  // ── BM language cases ─────────────────────────────────────────────────────
  ['apa wifi password',                    'wifi',         'BM wifi – apa password'],
  ['boleh saya check out lambat',          'late_checkout_request', 'BM late checkout'],
  ['ada tempat letak kereta',              'parking',      'BM parking – letak kereta'],
  ['tolong bantu saya',                    'emergency',    'BM emergency – tolong bantu'],
  ['berapa harga satu malam',              'pricing',      'BM pricing – berapa harga'],

  // ── Payment intents ───────────────────────────────────────────────────────
  ['I already made the payment',           'payment_made', 'T2 payment_made – made'],
  ['what payment methods do you accept',   'payment_info', 'T2 payment_info – methods'],
  ['can I pay by cash',                    'payment_info', 'T2 payment_info – cash'],

  // ── Cleanliness complaint ─────────────────────────────────────────────────
  ['the room is dirty',                    'cleanliness_complaint', 'T2 cleanliness'],
  ['bathroom not clean',                   'cleanliness_complaint', 'T2 cleanliness – bathroom'],

  // ── Checkout now / procedure ──────────────────────────────────────────────
  ['I am checking out now',               'checkout_now',       'T1/T2 checkout now'],
  ['how do I return the key card',        'checkout_procedure', 'T2 checkout procedure – key'],

  // ── Cancel policy vs cancel booking ──────────────────────────────────────
  ['what is your cancellation policy',    'cancel_policy',  'T2 cancel_policy – policy question'],
  ['I want to cancel my reservation',     'cancel_booking', 'T2 cancel_booking – intent to cancel'],

  // ── Forgot item post checkout ─────────────────────────────────────────────
  ['I left my charger in the room',       'forgot_item_post_checkout', 'T2 forgot_item – charger'],
  ['I checked out but forgot my bag',     'forgot_item_post_checkout', 'T2 forgot_item – bag'],
];

async function chat(message) {
  const res = await fetch(BASE_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId: 'gold-' + Date.now() + Math.random(), profile: PROFILE }),
  });
  return res.json();
}

const failures = [];
let correct = 0;

for (const [msg, expected, label] of GOLD) {
  try {
    const r = await chat(msg);
    const got = r.intent || '';
    if (got === expected) {
      correct++;
    } else {
      failures.push({ msg, expected, got, source: r.source, confidence: r.confidence, label });
      process.stderr.write(`  ✗ [${r.source}] got=${got} exp=${expected}  "${msg}" (${label})\n`);
    }
  } catch (e) {
    failures.push({ msg, expected, got: 'ERROR', source: 'error', label, error: e.message });
    process.stderr.write(`  ! ERROR: ${e.message}  "${msg}"\n`);
  }
}

const total = GOLD.length;
const score = correct / total;
process.stderr.write(`\nSCORE: ${correct}/${total} (${(score * 100).toFixed(0)}%)\n`);

console.log(JSON.stringify({ score, correct, total, failures }, null, 2));
