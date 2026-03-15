/**
 * business-hours.ts — Timezone-aware business hours availability checker (US-846)
 *
 * Uses native Intl.DateTimeFormat for timezone-aware time comparison.
 * No external dependencies required.
 */

export interface BusinessHoursSchedule {
  day: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  open: string; // "HH:MM" in 24h format, e.g. "09:00"
  close: string; // "HH:MM" in 24h format, e.g. "17:00"
}

export interface BusinessHoursConfig {
  timezone: string; // IANA timezone, e.g. "Asia/Kuala_Lumpur"
  schedule: BusinessHoursSchedule[];
  holidays?: string[]; // ISO date strings "YYYY-MM-DD" for public holiday overrides
}

export interface AvailabilityResult {
  isAvailable: boolean;
  nextOpenTime: string | null; // Human-readable, e.g. "Today at 09:00", "Tomorrow at 09:00", "Monday at 09:00"
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Compute availability given a businessHours config and the current time.
 * Returns { isAvailable: true, nextOpenTime: null } when no config is provided
 * (i.e. always open by default).
 */
export function computeAvailability(
  businessHours: BusinessHoursConfig | undefined | null,
  now: Date = new Date()
): AvailabilityResult {
  // No config = always available
  if (!businessHours || !Array.isArray(businessHours.schedule) || businessHours.schedule.length === 0) {
    return { isAvailable: true, nextOpenTime: null };
  }

  const timezone = businessHours.timezone || 'UTC';
  const holidays: string[] = Array.isArray(businessHours.holidays) ? businessHours.holidays : [];
  const schedule = businessHours.schedule;

  // Get current date/time parts in the configured timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;

  // Handle midnight edge case where hour may be "24" in some implementations
  const rawHour = p.hour === '24' ? '00' : p.hour;
  const currentHHMM = `${rawHour}:${p.minute}`;
  const todayStr = `${p.year}-${p.month}-${p.day}`;

  // Map weekday abbreviation to 0-6
  const dayAbbrevMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const todayDow = dayAbbrevMap[p.weekday] ?? -1;

  // Holiday override — treat as fully closed for today
  if (holidays.includes(todayStr)) {
    const next = findNextOpenDay(schedule, todayDow, 1);
    return { isAvailable: false, nextOpenTime: next };
  }

  // Check today's schedule
  const todaySchedule = schedule.find(s => s.day === todayDow);
  if (todaySchedule) {
    if (currentHHMM >= todaySchedule.open && currentHHMM < todaySchedule.close) {
      return { isAvailable: true, nextOpenTime: null };
    }
    // Before opening time today
    if (currentHHMM < todaySchedule.open) {
      return { isAvailable: false, nextOpenTime: `Today at ${todaySchedule.open}` };
    }
    // After closing time today — look ahead
  }

  // Find next open day (up to 7 days ahead)
  const next = findNextOpenDay(schedule, todayDow, 1);
  return { isAvailable: false, nextOpenTime: next };
}

function findNextOpenDay(
  schedule: BusinessHoursSchedule[],
  todayDow: number,
  startOffset: number
): string | null {
  for (let i = startOffset; i <= 7; i++) {
    const nextDow = (todayDow + i) % 7;
    const nextSchedule = schedule.find(s => s.day === nextDow);
    if (nextSchedule) {
      const label = i === 1 ? 'Tomorrow' : DAY_NAMES[nextDow];
      return `${label} at ${nextSchedule.open}`;
    }
  }
  return null;
}
