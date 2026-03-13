/**
 * Phone Number Quality State Manager (US-458)
 *
 * Tracks WhatsApp phone number quality rating and status per profile.
 * When status is FLAGGED, blocks new business-initiated (proactive) messages
 * while still allowing replies to user messages.
 *
 * State is stored in-memory with persistence to rainbow_configs DB table.
 */

import { loadConfigFromDB, saveConfigToDB } from './config-db.js';

export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export type QualityStatus = 'CONNECTED' | 'FLAGGED' | 'RESTRICTED' | 'UNKNOWN';

export interface PhoneQualityState {
  rating: QualityRating;
  status: QualityStatus;
  messagingLimitTier?: string;
  lastEvent?: string;           // e.g. 'FLAGGED', 'UNFLAGGED', 'QUALITY_SCORE_CHANGE'
  lastUpdatedAt: string;        // ISO timestamp
  phoneNumber?: string;
}

const DB_KEY = 'phone_quality_state';

// In-memory state per profile
const qualityState = new Map<string, PhoneQualityState>();

/** Get the current quality state for a profile */
export function getQualityState(profileId: string = 'pelangi'): PhoneQualityState {
  return qualityState.get(profileId) ?? {
    rating: 'UNKNOWN',
    status: 'UNKNOWN',
    lastUpdatedAt: new Date().toISOString(),
  };
}

/** Get quality states for all profiles */
export function getAllQualityStates(): Record<string, PhoneQualityState> {
  const result: Record<string, PhoneQualityState> = {};
  for (const [profileId, state] of qualityState) {
    result[profileId] = state;
  }
  return result;
}

/** Check if business-initiated messages should be blocked for a profile */
export function isOutboundBlocked(profileId: string = 'pelangi'): boolean {
  const state = qualityState.get(profileId);
  if (!state) return false;
  return state.status === 'FLAGGED' || state.status === 'RESTRICTED';
}

/**
 * Update quality state from a webhook event.
 * Persists to DB asynchronously.
 */
export async function updateQualityState(
  profileId: string,
  update: {
    rating?: QualityRating;
    status?: QualityStatus;
    event?: string;
    messagingLimitTier?: string;
    phoneNumber?: string;
  }
): Promise<PhoneQualityState> {
  const current = getQualityState(profileId);

  const newState: PhoneQualityState = {
    rating: update.rating ?? current.rating,
    status: update.status ?? current.status,
    messagingLimitTier: update.messagingLimitTier ?? current.messagingLimitTier,
    lastEvent: update.event ?? current.lastEvent,
    lastUpdatedAt: new Date().toISOString(),
    phoneNumber: update.phoneNumber ?? current.phoneNumber,
  };

  qualityState.set(profileId, newState);

  // Persist to DB (fire-and-forget)
  persistToDb().catch(err =>
    console.error('[PhoneQuality] Failed to persist state to DB:', err.message)
  );

  return newState;
}

/** Load quality state from DB on startup */
export async function loadQualityStateFromDb(): Promise<void> {
  try {
    const data = await loadConfigFromDB(DB_KEY);
    if (data && typeof data === 'object') {
      for (const [profileId, state] of Object.entries(data)) {
        if (state && typeof state === 'object') {
          qualityState.set(profileId, state as PhoneQualityState);
        }
      }
      console.log(`[PhoneQuality] Loaded state for ${qualityState.size} profile(s) from DB`);
    }
  } catch (err: any) {
    console.error('[PhoneQuality] Failed to load state from DB:', err.message);
  }
}

async function persistToDb(): Promise<void> {
  const data: Record<string, PhoneQualityState> = {};
  for (const [profileId, state] of qualityState) {
    data[profileId] = state;
  }
  await saveConfigToDB(DB_KEY, data, 'phone_quality_webhook');
}
