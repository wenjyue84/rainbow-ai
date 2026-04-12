/**
 * profile-audit-scheduler.ts — Hourly automated profile separation validation
 *
 * Runs a cron job at 00:00 UTC+8 each hour to:
 * 1. Load intent_keywords.json, knowledge.json, workflows.json from all profiles
 * 2. Compare profiles using string similarity scoring
 * 3. Store contamination results in rainbow_config_audit table
 * 4. Alert if contamination_score > 0.2 (20% threshold)
 */

import cron from 'node-cron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  extractTextChunks,
  calculateContaminationScore,
  findDuplicateChunks,
} from './content-similarity.js';
import { pool } from './db.js';
import { profileRegistry } from '../assistant/profile-registry.js';

// Contamination threshold: alert if score > 0.2 (20%)
const CONTAMINATION_ALERT_THRESHOLD = 0.2;

// Similarity threshold for finding duplicates: 85%
const DUPLICATE_SIMILARITY_THRESHOLD = 0.85;

export interface AuditResult {
  profilePair: string; // "profile1_vs_profile2"
  contaminationScore: number; // 0-1
  detectedDuplicates: Array<{ text: string; similarity: number }>;
  filesCompared: string[]; // intent_keywords.json, knowledge.json, workflows.json
  auditTime: Date;
}

/**
 * Load config files from a profile's data directory.
 * Returns combined text chunks from intent_keywords, knowledge, and workflows.
 */
async function loadProfileContent(
  profileId: string,
  dataDir: string
): Promise<{
  chunks: string[];
  filesList: string[];
}> {
  const chunks: string[] = [];
  const filesList: string[] = [];
  const filesToCheck = [
    'intent_keywords.json',
    'knowledge.json',
    'workflows.json',
  ];

  for (const fileName of filesToCheck) {
    const filePath = join(dataDir, fileName);

    if (!existsSync(filePath)) {
      console.warn(
        `[profile-audit] Profile "${profileId}" missing ${fileName}`
      );
      continue;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const json = JSON.parse(content);
      const fileChunks = extractTextChunks(json, 500);
      chunks.push(...fileChunks);
      filesList.push(fileName);
    } catch (err: any) {
      console.error(
        `[profile-audit] Error loading ${profileId}/${fileName}: ${err.message}`
      );
    }
  }

  return { chunks, filesList };
}

/**
 * Run the profile separation audit.
 * Compares all profile pairs and stores results in rainbow_config_audit.
 */
export async function runProfileAudit(): Promise<AuditResult[]> {
  console.log('[profile-audit] Starting hourly profile separation audit...');

  const results: AuditResult[] = [];

  try {
    // Get all enabled profiles from the registry
    const profiles = profileRegistry.listProfiles();

    if (profiles.length < 2) {
      console.log('[profile-audit] Only 1 or fewer profiles enabled, skipping');
      return results;
    }

    // Load content for all profiles
    const profileContents = new Map<
      string,
      { chunks: string[]; dataDir: string; filesList: string[] }
    >();

    for (const profile of profiles) {
      const { chunks, filesList } = await loadProfileContent(
        profile.id,
        profile.config.dataDir
      );
      profileContents.set(profile.id, { chunks, dataDir: profile.config.dataDir, filesList });
    }

    // Compare all profile pairs
    const profileIds = Array.from(profileContents.keys());
    for (let i = 0; i < profileIds.length; i++) {
      for (let j = i + 1; j < profileIds.length; j++) {
        const id1 = profileIds[i];
        const id2 = profileIds[j];

        const content1 = profileContents.get(id1)!;
        const content2 = profileContents.get(id2)!;

        const contaminationScore = calculateContaminationScore(
          content1.chunks,
          content2.chunks,
          DUPLICATE_SIMILARITY_THRESHOLD
        );

        const detectedDuplicates = findDuplicateChunks(
          content1.chunks,
          content2.chunks,
          DUPLICATE_SIMILARITY_THRESHOLD
        );

        const profilePair = `${id1}_vs_${id2}`;
        const result: AuditResult = {
          profilePair,
          contaminationScore,
          detectedDuplicates,
          filesCompared: [...new Set([...content1.filesList, ...content2.filesList])],
          auditTime: new Date(),
        };

        results.push(result);

        // Alert if contamination exceeds threshold
        if (contaminationScore > CONTAMINATION_ALERT_THRESHOLD) {
          console.error(
            `[profile-audit] ⚠️ CONTAMINATION DETECTED: ${profilePair} score=${contaminationScore.toFixed(3)}`
          );
          console.error(
            `[profile-audit]   Files compared: ${result.filesCompared.join(', ')}`
          );
          if (detectedDuplicates.length > 0) {
            console.error(
              `[profile-audit]   First 3 duplicates:`
            );
            for (const dup of detectedDuplicates.slice(0, 3)) {
              console.error(
                `[profile-audit]   - "${dup.text.substring(0, 80)}..." (${(dup.similarity * 100).toFixed(1)}% similar)`
              );
            }
          }
        }

        // Store in database
        try {
          await storeAuditResult(result);
        } catch (err: any) {
          console.error(
            `[profile-audit] Failed to store result for ${profilePair}: ${err.message}`
          );
        }
      }
    }

    console.log(
      `[profile-audit] Completed audit. Checked ${results.length} profile pairs.`
    );
  } catch (err: any) {
    console.error(`[profile-audit] Audit failed: ${err.message}`);
  }

  return results;
}

/**
 * Store audit result in rainbow_config_audit table (raw pg, not Drizzle).
 */
async function storeAuditResult(result: AuditResult): Promise<void> {
  const client = await pool.connect();

  try {
    const query = `
      INSERT INTO rainbow_config_audit
        (audit_type, profile_pair, contamination_score, detected_duplicates, audit_time)
      VALUES
        ($1, $2, $3, $4, $5)
    `;

    const values = [
      'profile_separation',
      result.profilePair,
      result.contaminationScore,
      JSON.stringify(result.detectedDuplicates),
      result.auditTime,
    ];

    await client.query(query, values);
  } finally {
    client.release();
  }
}

/**
 * Start the hourly audit scheduler.
 * Runs at 00:00 UTC+8 (midnight Bangkok time) every hour.
 *
 * Cron expression: "0 * * * *" = every hour at minute 0
 */
export function startProfileAuditScheduler(): void {
  console.log('[profile-audit] Initializing hourly audit scheduler...');

  // Run audit every hour at minute 0 (UTC+8 midnight = 00:00)
  const task = cron.schedule('0 * * * *', async () => {
    await runProfileAudit();
  });

  // Also run immediately on startup (non-blocking)
  console.log('[profile-audit] Running initial audit...');
  runProfileAudit().catch(err =>
    console.error('[profile-audit] Initial audit failed:', err)
  );

  console.log('[profile-audit] Scheduler started. Will run hourly.');
  return task;
}

/**
 * Get recent audit results from the database.
 * @param limit Number of recent results to fetch (default 10)
 */
export async function getRecentAuditResults(
  limit: number = 10
): Promise<AuditResult[]> {
  const client = await pool.connect();

  try {
    const query = `
      SELECT
        profile_pair as "profilePair",
        contamination_score as "contaminationScore",
        detected_duplicates as "detectedDuplicates",
        audit_time as "auditTime"
      FROM rainbow_config_audit
      WHERE audit_type = 'profile_separation'
      ORDER BY audit_time DESC
      LIMIT $1
    `;

    const result = await client.query(query, [limit]);

    return result.rows.map(row => ({
      profilePair: row.profilePair,
      contaminationScore: row.contaminationScore,
      detectedDuplicates: JSON.parse(row.detectedDuplicates || '[]'),
      filesCompared: [], // Not stored, would need to enhance schema
      auditTime: row.auditTime,
    }));
  } finally {
    client.release();
  }
}
