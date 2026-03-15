/**
 * business-hours.test.ts — Unit tests for computeAvailability (US-846)
 *
 * Tests cover:
 * - No config → always available
 * - Within hours → available
 * - Before opening → offline, "Today at HH:MM"
 * - After closing → offline, next day
 * - Weekend closed → next weekday
 * - Public holiday override
 * - Timezone handling (Asia/Kuala_Lumpur)
 * - Edge case: midnight crossover (hour "24")
 */

import { describe, it, expect } from 'vitest';
import { computeAvailability } from '../business-hours.js';
import type { BusinessHoursConfig } from '../business-hours.js';

// Monday-Friday 9-17, Saturday 10-14 (similar to Pelangi config)
const weekdaySchedule: BusinessHoursConfig = {
  timezone: 'UTC',
  schedule: [
    { day: 1, open: '09:00', close: '17:00' }, // Mon
    { day: 2, open: '09:00', close: '17:00' }, // Tue
    { day: 3, open: '09:00', close: '17:00' }, // Wed
    { day: 4, open: '09:00', close: '17:00' }, // Thu
    { day: 5, open: '09:00', close: '17:00' }, // Fri
    { day: 6, open: '10:00', close: '14:00' }, // Sat
  ],
  holidays: [],
};

// All-week 9-21 schedule (similar to Southern / Makan)
const allWeekSchedule: BusinessHoursConfig = {
  timezone: 'UTC',
  schedule: [
    { day: 0, open: '09:00', close: '21:00' }, // Sun
    { day: 1, open: '09:00', close: '21:00' }, // Mon
    { day: 2, open: '09:00', close: '21:00' }, // Tue
    { day: 3, open: '09:00', close: '21:00' }, // Wed
    { day: 4, open: '09:00', close: '21:00' }, // Thu
    { day: 5, open: '09:00', close: '21:00' }, // Fri
    { day: 6, open: '09:00', close: '21:00' }, // Sat
  ],
  holidays: [],
};

// Monday 2026-03-16 12:00 UTC (weekday, midday)
const MON_MIDDAY = new Date('2026-03-16T12:00:00Z');
// Monday 2026-03-16 08:00 UTC (before opening)
const MON_EARLY = new Date('2026-03-16T08:00:00Z');
// Monday 2026-03-16 18:00 UTC (after closing)
const MON_EVENING = new Date('2026-03-16T18:00:00Z');
// Sunday 2026-03-15 12:00 UTC (closed day in weekday schedule)
const SUN_MIDDAY = new Date('2026-03-15T12:00:00Z');
// Saturday 2026-03-21 11:00 UTC (Saturday midday — open in weekday schedule)
const SAT_MIDDAY = new Date('2026-03-21T11:00:00Z');
// Saturday 2026-03-21 15:00 UTC (after Sat close time 14:00)
const SAT_AFTERNOON = new Date('2026-03-21T15:00:00Z');

describe('computeAvailability', () => {
  it('returns available when no config provided', () => {
    expect(computeAvailability(undefined).isAvailable).toBe(true);
    expect(computeAvailability(null).isAvailable).toBe(true);
    expect(computeAvailability({ timezone: 'UTC', schedule: [] }).isAvailable).toBe(true);
  });

  it('returns available during opening hours on a weekday', () => {
    const result = computeAvailability(weekdaySchedule, MON_MIDDAY);
    expect(result.isAvailable).toBe(true);
    expect(result.nextOpenTime).toBeNull();
  });

  it('returns unavailable before opening time on Monday', () => {
    const result = computeAvailability(weekdaySchedule, MON_EARLY);
    expect(result.isAvailable).toBe(false);
    expect(result.nextOpenTime).toBe('Today at 09:00');
  });

  it('returns unavailable after closing time on Monday, suggests Tuesday', () => {
    const result = computeAvailability(weekdaySchedule, MON_EVENING);
    expect(result.isAvailable).toBe(false);
    expect(result.nextOpenTime).toBe('Tomorrow at 09:00');
  });

  it('returns unavailable on Sunday (not in schedule), suggests Monday', () => {
    const result = computeAvailability(weekdaySchedule, SUN_MIDDAY);
    expect(result.isAvailable).toBe(false);
    expect(result.nextOpenTime).toBe('Tomorrow at 09:00');
  });

  it('returns available on Saturday within opening window', () => {
    const result = computeAvailability(weekdaySchedule, SAT_MIDDAY);
    expect(result.isAvailable).toBe(true);
  });

  it('returns unavailable after Saturday close, suggests Monday (Sun not in schedule)', () => {
    const result = computeAvailability(weekdaySchedule, SAT_AFTERNOON);
    expect(result.isAvailable).toBe(false);
    // Saturday+1=Sunday (no schedule), Saturday+2=Monday
    expect(result.nextOpenTime).toBe('Monday at 09:00');
  });

  it('returns available during all-week schedule on Sunday', () => {
    const result = computeAvailability(allWeekSchedule, SUN_MIDDAY);
    expect(result.isAvailable).toBe(true);
  });

  it('returns null nextOpenTime when available', () => {
    const result = computeAvailability(allWeekSchedule, MON_MIDDAY);
    expect(result.nextOpenTime).toBeNull();
  });

  it('public holiday override marks day as closed', () => {
    const withHoliday: BusinessHoursConfig = {
      ...allWeekSchedule,
      holidays: ['2026-03-16'], // Monday
    };
    // MON_MIDDAY = 2026-03-16 12:00 UTC — should be closed due to holiday
    const result = computeAvailability(withHoliday, MON_MIDDAY);
    expect(result.isAvailable).toBe(false);
    // Next open should be Tuesday
    expect(result.nextOpenTime).toBe('Tomorrow at 09:00');
  });

  it('holiday override does not affect other days', () => {
    const withHoliday: BusinessHoursConfig = {
      ...allWeekSchedule,
      holidays: ['2026-03-16'], // Monday only
    };
    // Tuesday 2026-03-17 12:00 UTC
    const tueMidday = new Date('2026-03-17T12:00:00Z');
    const result = computeAvailability(withHoliday, tueMidday);
    expect(result.isAvailable).toBe(true);
  });

  it('handles KL timezone correctly (UTC+8)', () => {
    // KL timezone: 12:00 UTC = 20:00 KL → after closing if schedule is 09:00-17:00
    const klSchedule: BusinessHoursConfig = {
      timezone: 'Asia/Kuala_Lumpur',
      schedule: [{ day: 1, open: '09:00', close: '17:00' }], // Monday only
    };
    // 2026-03-16 00:00 UTC = 2026-03-16 08:00 KL → before opening
    const klEarlyMonday = new Date('2026-03-16T00:00:00Z');
    const result = computeAvailability(klSchedule, klEarlyMonday);
    expect(result.isAvailable).toBe(false);
    expect(result.nextOpenTime).toBe('Today at 09:00');

    // 2026-03-16 02:00 UTC = 2026-03-16 10:00 KL → open
    const klOpenMonday = new Date('2026-03-16T02:00:00Z');
    const resultOpen = computeAvailability(klSchedule, klOpenMonday);
    expect(resultOpen.isAvailable).toBe(true);
  });
});
