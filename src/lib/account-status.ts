/**
 * WhatsApp Account Status State Manager (US-479)
 *
 * Tracks account_update webhook events from Meta Cloud API.
 * Surfaces active violations and restrictions so they appear in /health/ready.
 *
 * Two event types:
 *  - ACCOUNT_VIOLATION: policy violation with a violation_type string
 *  - ACCOUNT_RESTRICTION: temporary restriction with expiry timestamps
 */

export interface AccountViolationInfo {
  violationType: string;
  detectedAt: string;   // ISO timestamp
  phoneNumber?: string;
}

export interface AccountRestrictionEntry {
  restrictionType: string;
  expiration: number | null;  // Unix timestamp (seconds) or null = indefinite
}

export interface AccountRestrictionInfo {
  restrictions: AccountRestrictionEntry[];
  detectedAt: string;   // ISO timestamp
  phoneNumber?: string;
}

export interface AccountStatusState {
  activeViolation: AccountViolationInfo | null;
  activeRestrictions: AccountRestrictionEntry[];
  lastUpdatedAt: string;
  phoneNumber?: string;
}

// In-memory state — lightweight enough to not need DB persistence
// (violations are ephemeral; operator action is required regardless)
const accountStatusState: AccountStatusState = {
  activeViolation: null,
  activeRestrictions: [],
  lastUpdatedAt: new Date().toISOString(),
};

/** Return current account status (for health checks) */
export function getAccountStatus(): AccountStatusState {
  // Filter out expired restrictions
  const now = Math.floor(Date.now() / 1000);
  accountStatusState.activeRestrictions = accountStatusState.activeRestrictions.filter(
    r => r.expiration === null || r.expiration > now
  );
  return { ...accountStatusState };
}

/** Returns true if there is an active (non-expired) restriction or violation */
export function hasActiveAccountIssue(): boolean {
  const s = getAccountStatus();
  return s.activeViolation !== null || s.activeRestrictions.length > 0;
}

/** Record an ACCOUNT_VIOLATION event */
export function recordAccountViolation(violationType: string, phoneNumber?: string): void {
  accountStatusState.activeViolation = {
    violationType,
    detectedAt: new Date().toISOString(),
    phoneNumber,
  };
  accountStatusState.lastUpdatedAt = new Date().toISOString();
  accountStatusState.phoneNumber = phoneNumber ?? accountStatusState.phoneNumber;
}

/** Record an ACCOUNT_RESTRICTION event */
export function recordAccountRestriction(
  restrictions: AccountRestrictionEntry[],
  phoneNumber?: string
): void {
  // Merge new restrictions — replace same restrictionType entries
  for (const incoming of restrictions) {
    const idx = accountStatusState.activeRestrictions.findIndex(
      r => r.restrictionType === incoming.restrictionType
    );
    if (idx !== -1) {
      accountStatusState.activeRestrictions[idx] = incoming;
    } else {
      accountStatusState.activeRestrictions.push(incoming);
    }
  }
  accountStatusState.lastUpdatedAt = new Date().toISOString();
  accountStatusState.phoneNumber = phoneNumber ?? accountStatusState.phoneNumber;
}
