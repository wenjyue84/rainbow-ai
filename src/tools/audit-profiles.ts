#!/usr/bin/env node

/**
 * Profile Content Separation Audit Tool
 *
 * Scans all profile data files (knowledge.json, workflows.json, routing.json)
 * and identifies potential copy-paste contamination between profiles using TF-IDF cosine similarity.
 *
 * Usage: node audit-profiles.ts --output audit-report.csv --threshold 0.7
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface AuditResult {
  profile_a: string;
  profile_b: string;
  file_type: string;
  similarity_score: number;
  content_excerpt: string;
}

interface ProfileData {
  profile: string;
  file_type: string;
  content: string;
}

/**
 * Extract text content from various JSON file formats
 */
function extractContent(obj: unknown): string {
  const texts: string[] = [];

  function walk(val: unknown) {
    if (typeof val === 'string') {
      if (val.trim().length > 0) {
        texts.push(val.toLowerCase());
      }
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      for (const v of Object.values(val)) {
        walk(v);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        walk(item);
      }
    }
  }

  walk(obj);
  return texts.join(' ');
}

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2); // Filter out short tokens
}

/**
 * Calculate TF (term frequency) for a document
 */
function calculateTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const total = tokens.length;

  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1 / total);
  }

  return tf;
}

/**
 * Calculate IDF (inverse document frequency) for a corpus
 */
function calculateIDF(
  corpus: string[][],
): Map<string, number> {
  const idf = new Map<string, number>();
  const docCount = corpus.length;
  const docFreq = new Map<string, number>();

  // Count documents containing each term
  for (const tokens of corpus) {
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  // Calculate IDF
  for (const [term, freq] of docFreq.entries()) {
    idf.set(term, Math.log(docCount / freq));
  }

  return idf;
}

/**
 * Calculate TF-IDF vector for a document
 */
function calculateTFIDF(
  tokens: string[],
  idf: Map<string, number>,
): Map<string, number> {
  const tf = calculateTF(tokens);
  const tfidf = new Map<string, number>();

  for (const [term, tfVal] of tf.entries()) {
    const idfVal = idf.get(term) || 0;
    tfidf.set(term, tfVal * idfVal);
  }

  return tfidf;
}

/**
 * Calculate cosine similarity between two TF-IDF vectors
 */
function cosineSimilarity(
  vec1: Map<string, number>,
  vec2: Map<string, number>,
): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  // Combine all terms
  const allTerms = new Set([...vec1.keys(), ...vec2.keys()]);

  for (const term of allTerms) {
    const v1 = vec1.get(term) || 0;
    const v2 = vec2.get(term) || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Get a short excerpt from content
 */
function getExcerpt(content: string, maxLength: number = 50): string {
  return content.substring(0, maxLength).replace(/\n/g, ' ');
}

/**
 * Find all profile directories
 */
function findProfileDirs(dataDir: string): string[] {
  const profiles: string[] = [];
  const entries = fs.readdirSync(dataDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('data')) {
      profiles.push(path.join(dataDir, entry.name));
    }
  }

  return profiles.sort();
}

/**
 * Load profile data from JSON files
 */
function loadProfileData(profileDir: string): ProfileData[] {
  const results: ProfileData[] = [];
  const profileName = path.basename(profileDir);
  const filesToAudit = ['knowledge.json', 'workflows.json', 'routing.json'];

  for (const filename of filesToAudit) {
    const filePath = path.join(profileDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);
        const extracted = extractContent(json);

        results.push({
          profile: profileName,
          file_type: filename.replace('.json', ''),
          content: extracted,
        });
      } catch (err) {
        console.error(`Error reading ${filePath}:`, err);
      }
    }
  }

  return results;
}

/**
 * Generate audit report
 */
async function generateAuditReport(
  outputFile: string,
  threshold: number,
): Promise<void> {
  // Find all profile directories
  const dataDir = path.resolve(__dirname, '../assistant');
  const profileDirs = findProfileDirs(dataDir);

  if (profileDirs.length === 0) {
    console.error('No profile directories found');
    process.exit(1);
  }

  console.log(`Found ${profileDirs.length} profile directories`);

  // Load all profile data
  const allData: ProfileData[] = [];
  for (const dir of profileDirs) {
    const data = loadProfileData(dir);
    allData.push(...data);
    console.log(`Loaded ${data.length} files from ${path.basename(dir)}`);
  }

  if (allData.length === 0) {
    console.error('No data files found to audit');
    process.exit(1);
  }

  // Tokenize all content
  const tokenizedData = allData.map(d => ({
    ...d,
    tokens: tokenize(d.content),
  }));

  // Calculate IDF across all documents
  const corpus = tokenizedData.map(d => d.tokens);
  const idf = calculateIDF(corpus);

  // Calculate TF-IDF vectors
  const tfidfVectors = tokenizedData.map(d => ({
    ...d,
    tfidf: calculateTFIDF(d.tokens, idf),
  }));

  // Compare all pairs
  const results: AuditResult[] = [];

  for (let i = 0; i < tfidfVectors.length; i++) {
    for (let j = i + 1; j < tfidfVectors.length; j++) {
      const doc1 = tfidfVectors[i];
      const doc2 = tfidfVectors[j];

      // Only compare if different profiles
      if (doc1.profile === doc2.profile) {
        continue;
      }

      const similarity = cosineSimilarity(doc1.tfidf, doc2.tfidf);

      if (similarity > threshold) {
        results.push({
          profile_a: doc1.profile,
          profile_b: doc2.profile,
          file_type: `${doc1.file_type}→${doc2.file_type}`,
          similarity_score: Math.round(similarity * 1000) / 1000,
          content_excerpt: getExcerpt(doc1.content),
        });
      }
    }
  }

  // Sort by similarity (descending)
  results.sort((a, b) => b.similarity_score - a.similarity_score);

  // Write CSV
  let csv = 'profile_a,profile_b,file_type,similarity_score,content_excerpt\n';
  for (const result of results) {
    const excerpt = result.content_excerpt.replace(/"/g, '""');
    csv += `"${result.profile_a}","${result.profile_b}","${result.file_type}",${result.similarity_score},"${excerpt}"\n`;
  }

  fs.writeFileSync(outputFile, csv);
  console.log(`\nAudit report written to ${outputFile}`);
  console.log(`Found ${results.length} potential contamination issues above threshold ${threshold}`);

  if (results.length > 0) {
    console.log('\nTop contamination risks:');
    for (const result of results.slice(0, 5)) {
      console.log(
        `  ${result.profile_a} ↔ ${result.profile_b}: ${result.similarity_score} (${result.file_type})`,
      );
    }
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): { output: string; threshold: number } {
  const args = process.argv.slice(2);
  let output = 'audit-report.csv';
  let threshold = 0.7;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      output = args[i + 1];
      i++;
    } else if (args[i] === '--threshold' && i + 1 < args.length) {
      threshold = parseFloat(args[i + 1]);
      i++;
    }
  }

  return { output, threshold };
}

// Main
async function main() {
  const { output, threshold } = parseArgs();

  console.log(`Starting profile audit (threshold: ${threshold})...`);
  await generateAuditReport(output, threshold);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
