/**
 * US-819: Template variable interpolation for static reply messages.
 *
 * Resolves {{variableName}} placeholders in static reply text before delivery.
 * Unresolvable variables fall back to a configurable default (empty string).
 *
 * Supported variables:
 *   {{guestName}}      - Guest's WhatsApp display name
 *   {{checkInDate}}    - Check-in date from active booking state (ISO date)
 *   {{checkOutDate}}   - Check-out date from active booking state (ISO date)
 *   {{profileName}}    - Profile identifier (e.g. "pelangi", "southern")
 */

/** Interpolate {{variableName}} placeholders in a template string. */
export function interpolate(
  template: string,
  variables: Record<string, string>,
  fallback = ''
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return key in variables ? variables[key] : fallback;
  });
}

/** Build the variable context from PipelineState for static reply interpolation. */
export function buildInterpolationContext(
  pushName: string,
  profileId: string,
  bookingState: { checkIn?: string; checkOut?: string } | null
): Record<string, string> {
  return {
    guestName: pushName || '',
    profileName: profileId || '',
    checkInDate: bookingState?.checkIn || '',
    checkOutDate: bookingState?.checkOut || '',
  };
}
