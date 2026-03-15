/**
 * kb-embedding-audit.ts — Embedding Anomaly Detection for KB Integrity
 *
 * US-965 AC3/AC4: Compares KB document embeddings against a baseline
 * snapshot to detect anomalous content (potential data poisoning).
 *
 * Algorithm:
 *   1. On baseline creation: compute centroid of all chunk embeddings per source file
 *   2. On audit: recompute embeddings, compare each file's centroid distance
 *      to the baseline mean ± threshold (default: 2 standard deviations)
 *   3. Flag files whose centroid distance exceeds the threshold
 *
 * The baseline is stored in-memory and persisted to the DB as a signed
 * JSON config (via rainbow_configs key 'kb_embedding_baseline').
 */

import { createHash } from 'crypto';
import { loadConfigFromDB, saveConfigToDB } from '../lib/config-db.js';
import { auditKBEvent } from '../lib/config-db.js';

// ─── Types ─────────────────────────────────────────────────────────────

export interface EmbeddingBaseline {
  /** ISO timestamp when baseline was created */
  createdAt: string;
  /** SHA-256 of the serialized centroids (integrity check) */
  signature: string;
  /** Per-file centroid vectors */
  fileCentroids: Record<string, number[]>;
  /** Global mean centroid distance */
  meanDistance: number;
  /** Standard deviation of centroid distances */
  stdDevDistance: number;
}

export interface AnomalyReport {
  filename: string;
  centroidDistance: number;
  threshold: number;
  isAnomaly: boolean;
}

// ─── Configuration ─────────────────────────────────────────────────────

const BASELINE_CONFIG_KEY = 'kb_embedding_baseline';
const DEFAULT_ANOMALY_THRESHOLD_STDDEV = 2;

// ─── Cosine Similarity ─────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= vectors.length;
  return mean;
}

// ─── Baseline Management ───────────────────────────────────────────────

/**
 * Create a baseline snapshot from current KB embeddings.
 *
 * @param fileEmbeddings - Map of filename → array of chunk embedding vectors
 * @param operator - Who created the baseline
 * @returns The created baseline
 */
export async function createBaseline(
  fileEmbeddings: Map<string, number[][]>,
  operator: string = 'system'
): Promise<EmbeddingBaseline> {
  // Compute per-file centroids
  const fileCentroids: Record<string, number[]> = {};
  for (const [filename, embeddings] of fileEmbeddings) {
    if (embeddings.length === 0) continue;
    fileCentroids[filename] = meanVector(embeddings);
  }

  // Compute global centroid
  const allCentroids = Object.values(fileCentroids);
  const globalCentroid = meanVector(allCentroids);

  // Compute distances from each file centroid to global centroid
  const distances = allCentroids.map(c => 1 - cosineSimilarity(c, globalCentroid));

  // Mean and stddev of distances
  const meanDist = distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : 0;
  const variance = distances.length > 1
    ? distances.reduce((sum, d) => sum + (d - meanDist) ** 2, 0) / (distances.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);

  // Sign the baseline
  const centroidsJson = JSON.stringify(fileCentroids);
  const signature = createHash('sha256').update(centroidsJson).digest('hex');

  const baseline: EmbeddingBaseline = {
    createdAt: new Date().toISOString(),
    signature,
    fileCentroids,
    meanDistance: meanDist,
    stdDevDistance: stdDev,
  };

  // Persist to DB
  await saveConfigToDB(BASELINE_CONFIG_KEY, baseline, operator);
  console.log(
    `[KB:EmbeddingAudit] Baseline created: ${Object.keys(fileCentroids).length} files, ` +
    `mean distance=${meanDist.toFixed(4)}, stddev=${stdDev.toFixed(4)}`
  );

  return baseline;
}

/**
 * Load the baseline from DB.
 */
export async function loadBaseline(): Promise<EmbeddingBaseline | null> {
  const data = await loadConfigFromDB(BASELINE_CONFIG_KEY);
  if (!data) return null;

  // Verify baseline signature integrity
  const centroidsJson = JSON.stringify(data.fileCentroids);
  const expectedSig = createHash('sha256').update(centroidsJson).digest('hex');
  if (expectedSig !== data.signature) {
    console.error('[KB:EmbeddingAudit] Baseline signature mismatch — possible tampering!');
    await auditKBEvent('baseline_tampered', 'baseline', expectedSig, 'system',
      `Expected signature ${data.signature}, got ${expectedSig}`);
    return null;
  }

  return data as EmbeddingBaseline;
}

// ─── Anomaly Detection ─────────────────────────────────────────────────

/**
 * Run anomaly detection by comparing current embeddings to baseline.
 *
 * @param currentFileEmbeddings - Current KB file embeddings
 * @param thresholdStdDev - Number of standard deviations for anomaly threshold (default: 2)
 * @returns Array of anomaly reports
 */
export async function detectAnomalies(
  currentFileEmbeddings: Map<string, number[][]>,
  thresholdStdDev: number = DEFAULT_ANOMALY_THRESHOLD_STDDEV
): Promise<AnomalyReport[]> {
  const baseline = await loadBaseline();
  if (!baseline) {
    console.warn('[KB:EmbeddingAudit] No baseline found — skipping anomaly detection');
    return [];
  }

  const threshold = baseline.meanDistance + thresholdStdDev * baseline.stdDevDistance;
  const reports: AnomalyReport[] = [];

  // Compute global centroid from baseline
  const baselineCentroids = Object.values(baseline.fileCentroids);
  const globalCentroid = meanVector(baselineCentroids);

  for (const [filename, embeddings] of currentFileEmbeddings) {
    if (embeddings.length === 0) continue;
    const currentCentroid = meanVector(embeddings);
    const distance = 1 - cosineSimilarity(currentCentroid, globalCentroid);
    const isAnomaly = distance > threshold;

    reports.push({ filename, centroidDistance: distance, threshold, isAnomaly });

    if (isAnomaly) {
      console.warn(
        `[KB:EmbeddingAudit] ANOMALY: ${filename} distance=${distance.toFixed(4)} > threshold=${threshold.toFixed(4)}`
      );
      await auditKBEvent(
        'embedding_anomaly',
        filename,
        '',
        'system',
        `Centroid distance ${distance.toFixed(4)} exceeds threshold ${threshold.toFixed(4)} (${thresholdStdDev}σ)`
      );
    }
  }

  const anomalyCount = reports.filter(r => r.isAnomaly).length;
  console.log(
    `[KB:EmbeddingAudit] Audit complete: ${reports.length} files checked, ${anomalyCount} anomalies`
  );

  return reports;
}

/**
 * Run the nightly audit: compare current embeddings to baseline, alert on anomalies.
 * Called by the scheduled job or manually via admin API.
 *
 * @param getFileEmbeddings - Function that returns current file embeddings from the RAG system
 * @param alertOperator - Callback to notify operator of anomalies
 */
export async function runNightlyAudit(
  getFileEmbeddings: () => Promise<Map<string, number[][]>>,
  alertOperator: (anomalies: AnomalyReport[]) => Promise<void>
): Promise<AnomalyReport[]> {
  console.log('[KB:EmbeddingAudit] Starting nightly audit...');

  try {
    const fileEmbeddings = await getFileEmbeddings();
    const reports = await detectAnomalies(fileEmbeddings);
    const anomalies = reports.filter(r => r.isAnomaly);

    if (anomalies.length > 0) {
      await alertOperator(anomalies);
    }

    await auditKBEvent(
      'nightly_audit',
      'all',
      '',
      'system',
      `${reports.length} files checked, ${anomalies.length} anomalies found`
    );

    return reports;
  } catch (err: any) {
    console.error('[KB:EmbeddingAudit] Nightly audit failed:', err.message);
    return [];
  }
}
