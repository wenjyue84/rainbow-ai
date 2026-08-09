/**
 * US-337: Makan Moments Knowledge Base Pelangi Content Removal Tool — Pure Logic Module
 *
 * Identifies and removes Pelangi Capsule-specific content (hostel terminology,
 * room types, pricing) from data-makan/knowledge.json, preserving cafe-specific
 * content (menu items, promotions, operating hours).
 *
 * Pure logic module — no file I/O in the core functions (except load/write helpers).
 * All core functions accept data as parameters for easy testing.
 */

import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeResponse {
  en?: string;
  ms?: string;
  zh?: string;
  [key: string]: string | undefined;
}

export interface KnowledgeEntry {
  intent: string;
  response: KnowledgeResponse;
  id?: string;
  profile_id?: string;
}

export interface KnowledgeDynamic {
  [key: string]: string;
}

export interface KnowledgeFile {
  schema_version?: string;
  static: KnowledgeEntry[];
  dynamic?: KnowledgeDynamic;
}

export interface RemovalDetail {
  id: string | undefined;
  intent: string;
  reason: string;
  matchedPatterns: string[];
}

export interface DynamicRemovalDetail {
  key: string;
  reason: string;
  matchedPatterns: string[];
}

export interface RemovalReport {
  timestamp: string;
  profile: string;
  static_entries_before: number;
  static_entries_after: number;
  static_entries_removed: number;
  dynamic_keys_before: number;
  dynamic_keys_after: number;
  dynamic_keys_removed: number;
  removed_entries: RemovalDetail[];
  removed_dynamic_keys: DynamicRemovalDetail[];
  hostel_references_remaining: number;
  success: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hostel-specific intent names. If a knowledge entry has one of these intents,
 * it is Pelangi Capsule content and should be removed from makan profile.
 */
export const PELANGI_INTENT_PATTERNS: string[] = [
  'checkin_info',
  'check_in_arrival',
  'checkout_info',
  'checkout_now',
  'checkout_procedure',
  'late_checkout',
  'late_checkout_request',
  'capsule_conflict',
  'lower_deck_preference',
  'facility_orientation',
  'theft_report',
  'theft',
  'card_locked',
  'luggage_storage',
  'bag_storage',
  'stay_extension',
  'extend_stay',
  'prolong_stay',
  'room_type_inquiry',
  'room_type_preference',
  'unit_orientation',
  'unit_conflict',
  'security_incident',
  'access_issue',
  'wifi',
  'facilities',
  'rules',
  'booking',
  'booking_inquiry',
  'booking_modify',
  'booking_cancel',
];

/**
 * Hostel-specific keyword patterns (case-insensitive substring match).
 * If any response text in any language contains these, the entry is
 * Pelangi Capsule content.
 */
export const HOSTEL_CONTENT_PATTERNS: string[] = [
  'pelangi capsule',
  'pelangi hostel',
  'capsule hostel',
  'capsule pod',
  'capsule bed',
  'sleeping pod',
  'check-in',
  'check in',
  'checkin',
  'check-out',
  'check out',
  'checkout',
  'daftar masuk',
  'daftar keluar',
  '入住',
  '退房',
  'hostel',
  'dormitory',
  'dorm',
  'bunk',
  'upper deck',
  'lower deck',
  'upper bunk',
  'lower bunk',
  'key card',
  'keycard',
  'key-card',
  'door password',
  'luggage storage',
  'capsule guide',
  'room type',
  'room-type',
  '胶囊',
  '旅舍',
  'kapsul',
  'asrama',
];

/**
 * Cafe-specific keywords. If a response contains these, it is likely cafe
 * content and should be preserved even if it has borderline matches.
 */
export const CAFE_CONTENT_PATTERNS: string[] = [
  'makan moments',
  'cafe',
  'kafe',
  'menu',
  'nasi lemak',
  'mee goreng',
  'roti canai',
  'char kway teow',
  'teh tarik',
  'kopi',
  'toast',
  'breakfast',
  'lunch',
  'dinner',
  'sarapan',
  'makan tengah hari',
  'makan malam',
  'vegetarian',
  'allergen',
  'food',
  'makanan',
  'hidangan',
  'dish',
  'promotion',
  'promosi',
  'special',
  'combo',
  'daily specials',
];

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/**
 * Load and parse a knowledge.json file from disk.
 */
export function loadKnowledgeFile(filePath: string): KnowledgeFile {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as KnowledgeFile;
}

/**
 * Write a KnowledgeFile back to disk with pretty formatting.
 */
export function writeKnowledgeFile(filePath: string, data: KnowledgeFile): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Create a backup of a file by copying it to filePath.backup.
 */
export function createBackup(filePath: string): string {
  const backupPath = filePath + '.backup';
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Check if an intent name matches Pelangi-specific patterns.
 */
export function isPelangiIntent(intent: string): boolean {
  return PELANGI_INTENT_PATTERNS.includes(intent);
}

/**
 * Check if text contains any hostel-specific content patterns.
 * Returns the list of matched patterns.
 */
export function findHostelPatterns(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const pattern of HOSTEL_CONTENT_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      matched.push(pattern);
    }
  }
  return matched;
}

/**
 * Check if text contains cafe-specific content patterns.
 */
export function hasCafeContent(text: string): boolean {
  const lower = text.toLowerCase();
  for (const pattern of CAFE_CONTENT_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Concatenate all response text from a knowledge entry into a single string.
 */
export function getAllResponseText(entry: KnowledgeEntry): string {
  const parts: string[] = [];
  for (const value of Object.values(entry.response)) {
    if (typeof value === 'string') {
      parts.push(value);
    }
  }
  return parts.join(' ');
}

/**
 * Determine if a static knowledge entry is Pelangi Capsule content
 * that should be removed from the makan profile.
 *
 * Returns removal detail or null if the entry should be kept.
 */
export function shouldRemoveEntry(entry: KnowledgeEntry): RemovalDetail | null {
  const matchedPatterns: string[] = [];
  const reasons: string[] = [];

  // Check 1: Is the intent itself hostel-specific?
  if (isPelangiIntent(entry.intent)) {
    matchedPatterns.push(`intent:${entry.intent}`);
    reasons.push(`hostel-specific intent '${entry.intent}'`);
  }

  // Check 2: Does the profile_id indicate Pelangi?
  if (entry.profile_id && entry.profile_id === 'pelangi') {
    matchedPatterns.push('profile_id:pelangi');
    reasons.push('profile_id is pelangi');
  }

  // Check 3: Does the response text contain hostel-specific content?
  const responseText = getAllResponseText(entry);
  const hostelMatches = findHostelPatterns(responseText);
  if (hostelMatches.length > 0) {
    matchedPatterns.push(...hostelMatches.map(p => `content:${p}`));
    reasons.push(`response contains hostel terms: ${hostelMatches.join(', ')}`);
  }

  // If no hostel indicators found, keep the entry
  if (matchedPatterns.length === 0) {
    return null;
  }

  // If the entry has cafe content AND no intent/profile_id match,
  // it's likely a cafe entry with borderline wording — keep it.
  const isCafe = hasCafeContent(responseText);
  const hasIntentMatch = isPelangiIntent(entry.intent);
  const hasPelangiProfile = entry.profile_id === 'pelangi';

  if (isCafe && !hasIntentMatch && !hasPelangiProfile) {
    return null;
  }

  return {
    id: entry.id,
    intent: entry.intent,
    reason: reasons.join('; '),
    matchedPatterns,
  };
}

/**
 * Check if a dynamic key/value pair contains hostel-specific content.
 */
export function shouldRemoveDynamicEntry(key: string, value: string): DynamicRemovalDetail | null {
  const combined = `${key} ${value}`;
  const hostelMatches = findHostelPatterns(combined);

  if (hostelMatches.length === 0) {
    return null;
  }

  // Check for cafe content override
  if (hasCafeContent(combined)) {
    return null;
  }

  return {
    key,
    reason: `contains hostel terms: ${hostelMatches.join(', ')}`,
    matchedPatterns: hostelMatches,
  };
}

/**
 * Count remaining hostel references in the cleaned knowledge file.
 */
export function countHostelReferences(data: KnowledgeFile): number {
  let count = 0;

  for (const entry of data.static) {
    const text = getAllResponseText(entry);
    const matches = findHostelPatterns(text);
    if (matches.length > 0) {
      count++;
    }
  }

  if (data.dynamic) {
    for (const [key, value] of Object.entries(data.dynamic)) {
      const combined = `${key} ${value}`;
      const matches = findHostelPatterns(combined);
      if (matches.length > 0) {
        count++;
      }
    }
  }

  return count;
}

/**
 * Run the Pelangi content removal process on a knowledge.json file.
 *
 * Analyzes each static entry and dynamic key for hostel-specific content,
 * removes entries that are Pelangi Capsule content, and returns the
 * cleaned data with a removal report.
 */
export function runPelangiContentRemoval(
  profileName: string,
  knowledgeData: KnowledgeFile,
): { report: RemovalReport; cleaned: KnowledgeFile } {
  const removedEntries: RemovalDetail[] = [];
  const removedDynamicKeys: DynamicRemovalDetail[] = [];
  const cleanedStatic: KnowledgeEntry[] = [];

  // Process static entries
  for (const entry of knowledgeData.static) {
    const removal = shouldRemoveEntry(entry);
    if (removal) {
      removedEntries.push(removal);
    } else {
      cleanedStatic.push(entry);
    }
  }

  // Process dynamic entries
  const cleanedDynamic: KnowledgeDynamic = {};
  if (knowledgeData.dynamic) {
    for (const [key, value] of Object.entries(knowledgeData.dynamic)) {
      const removal = shouldRemoveDynamicEntry(key, value);
      if (removal) {
        removedDynamicKeys.push(removal);
      } else {
        cleanedDynamic[key] = value;
      }
    }
  }

  const cleaned: KnowledgeFile = {
    ...knowledgeData,
    static: cleanedStatic,
    dynamic: Object.keys(cleanedDynamic).length > 0 ? cleanedDynamic : knowledgeData.dynamic ? cleanedDynamic : undefined,
  };

  // Validate no hostel references remain
  const hostelRefsRemaining = countHostelReferences(cleaned);

  const report: RemovalReport = {
    timestamp: new Date().toISOString(),
    profile: profileName,
    static_entries_before: knowledgeData.static.length,
    static_entries_after: cleanedStatic.length,
    static_entries_removed: removedEntries.length,
    dynamic_keys_before: knowledgeData.dynamic ? Object.keys(knowledgeData.dynamic).length : 0,
    dynamic_keys_after: Object.keys(cleanedDynamic).length,
    dynamic_keys_removed: removedDynamicKeys.length,
    removed_entries: removedEntries,
    removed_dynamic_keys: removedDynamicKeys,
    hostel_references_remaining: hostelRefsRemaining,
    success: true,
  };

  return { report, cleaned };
}
