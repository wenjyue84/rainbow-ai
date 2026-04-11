/**
 * US-493: Profile Data Content Audit Report Generator with Migration Checklist
 *
 * Audits profile data files to identify content overlaps, duplicate keywords,
 * and business-specific contamination between profiles. Generates detailed
 * reports with file paths, line numbers, and a step-by-step migration checklist.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContaminationIssue {
  profile: string;
  file: string;
  filePath: string;
  entry: string;
  entryType: 'intent_route' | 'keyword' | 'knowledge_entry';
  contaminantKeywords: string[];
  contaminantProfile: string;
  confidence: number;
  lineNumbers: number[];
  occurrenceCount: number;
  description: string;
}

export interface DetailedAuditReport {
  timestamp: string;
  profilesAnalyzed: string[];
  totalIssues: number;
  issuesByProfile: Record<string, ContaminationIssue[]>;
  issuesByFile: Record<string, ContaminationIssue[]>;
  summary: {
    totalFiles: number;
    affectedFiles: number;
    highConfidenceIssues: number;
  };
}

export interface MigrationStep {
  stepNumber: number;
  profile: string;
  file: string;
  filePath: string;
  entry: string;
  issue: string;
  grepCommand: string;
  removalInstructions: string[];
  verificationCommand: string;
}

export interface MigrationChecklist {
  generatedAt: string;
  totalSteps: number;
  steps: MigrationStep[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROFILE_DIRS: Record<string, string> = {
  'makan': path.join(rootDir, 'src/assistant/data-makan'),
  'pelangi': path.join(rootDir, 'src/assistant/data'),
  'southern': path.join(rootDir, 'src/assistant/data-southern'),
};

const PROFILE_LABELS: Record<string, string> = {
  'makan': 'Makan Moments',
  'pelangi': 'Pelangi Capsule',
  'southern': 'Southern Homestay',
};

const CONTAMINATION_KEYWORDS: Record<string, Record<string, string[]>> = {
  'makan': {
    'hostel_specific': [
      'check_in_arrival', 'checkout_info', 'checkout_now', 'checkout_procedure',
      'checkin_info', 'late_checkout', 'late_checkout_request', 'capsule_conflict',
      'lower_deck_preference', 'facility_orientation', 'theft_report', 'card_locked',
      'luggage_storage', 'stay_extension', 'extend_stay', 'room_type_inquiry'
    ]
  },
  'southern': {
    'pelangi_capsule_specific': [
      'capsule_conflict', 'lower_deck_preference', 'card_locked', 'theft_report',
      'checkout_procedure', 'late_checkout', 'checkout_now', 'checkout_info'
    ]
  }
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Load JSON file with error handling
 */
function loadJsonFile(filePath: string): any {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Find line numbers where a keyword appears in text
 */
function findKeywordLines(fileContent: string, keyword: string): number[] {
  const lines = fileContent.split('\n');
  const lineNumbers: number[] = [];
  const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'gi');

  lines.forEach((line, index) => {
    if (keywordRegex.test(line)) {
      lineNumbers.push(index + 1);
    }
  });

  return lineNumbers;
}

/**
 * Audit a specific profile for contamination
 */
function auditProfile(
  profileKey: string,
  profilePath: string,
): ContaminationIssue[] {
  const issues: ContaminationIssue[] = [];

  // Check routing.json for contaminated intents
  const routingPath = path.join(profilePath, 'routing.json');
  if (fs.existsSync(routingPath)) {
    const routingContent = fs.readFileSync(routingPath, 'utf-8');
    const routing = loadJsonFile(routingPath);

    if (routing && typeof routing === 'object') {
      const contaminatedIntents = CONTAMINATION_KEYWORDS[profileKey] || {};

      for (const category of Object.values(contaminatedIntents)) {
        for (const keyword of category) {
          if (routing[keyword]) {
            const lineNumbers = findKeywordLines(routingContent, keyword);
            const contaminantProfile = profileKey === 'southern' ? 'pelangi' : 'pelangi';

            issues.push({
              profile: profileKey,
              file: 'routing.json',
              filePath: routingPath,
              entry: keyword,
              entryType: 'intent_route',
              contaminantKeywords: [keyword],
              contaminantProfile,
              confidence: 0.9,
              lineNumbers,
              occurrenceCount: lineNumbers.length,
              description: `Intent '${keyword}' from ${PROFILE_LABELS[contaminantProfile]} found in ${PROFILE_LABELS[profileKey]}`,
            });
          }
        }
      }
    }
  }

  // Check intent-keywords.json for contaminated keywords
  const keywordsPath = path.join(profilePath, 'intent-keywords.json');
  if (fs.existsSync(keywordsPath)) {
    const keywordsContent = fs.readFileSync(keywordsPath, 'utf-8');
    const keywords = loadJsonFile(keywordsPath);

    if (keywords && keywords.intents) {
      const contaminatedIntents = CONTAMINATION_KEYWORDS[profileKey] || {};

      for (const intent of keywords.intents) {
        for (const category of Object.values(contaminatedIntents)) {
          for (const keyword of category) {
            if (intent.intent === keyword) {
              const lineNumbers = findKeywordLines(keywordsContent, keyword);
              const contaminantProfile = profileKey === 'southern' ? 'pelangi' : 'pelangi';

              issues.push({
                profile: profileKey,
                file: 'intent-keywords.json',
                filePath: keywordsPath,
                entry: keyword,
                entryType: 'keyword',
                contaminantKeywords: [keyword],
                contaminantProfile,
                confidence: 0.85,
                lineNumbers,
                occurrenceCount: lineNumbers.length,
                description: `Keyword '${keyword}' from ${PROFILE_LABELS[contaminantProfile]} found in ${PROFILE_LABELS[profileKey]}`,
              });
            }
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Generate detailed audit report
 */
export function generateAuditReport(
  profilesAnalyzed: string[] = Object.keys(PROFILE_DIRS),
): DetailedAuditReport {
  const allIssues: ContaminationIssue[] = [];
  const issuesByProfile: Record<string, ContaminationIssue[]> = {};
  const issuesByFile: Record<string, ContaminationIssue[]> = {};
  const filesAnalyzed = new Set<string>();
  const affectedFiles = new Set<string>();

  // Audit each profile
  for (const profileKey of profilesAnalyzed) {
    const profilePath = PROFILE_DIRS[profileKey];
    if (!profilePath || !fs.existsSync(profilePath)) {
      continue;
    }

    // Count files in profile
    const dataDir = profilePath;
    if (fs.existsSync(dataDir)) {
      const files = fs.readdirSync(dataDir);
      files.forEach(f => {
        if (f.endsWith('.json')) {
          filesAnalyzed.add(`${profileKey}/${f}`);
        }
      });
    }

    // Audit profile
    const issues = auditProfile(profileKey, profilePath);
    allIssues.push(...issues);

    if (!issuesByProfile[profileKey]) {
      issuesByProfile[profileKey] = [];
    }
    issuesByProfile[profileKey].push(...issues);

    // Group by file
    for (const issue of issues) {
      const fileKey = `${profileKey}/${issue.file}`;
      if (!issuesByFile[fileKey]) {
        issuesByFile[fileKey] = [];
      }
      issuesByFile[fileKey].push(issue);
      affectedFiles.add(fileKey);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    profilesAnalyzed,
    totalIssues: allIssues.length,
    issuesByProfile,
    issuesByFile,
    summary: {
      totalFiles: filesAnalyzed.size,
      affectedFiles: affectedFiles.size,
      highConfidenceIssues: allIssues.filter(i => i.confidence >= 0.85).length,
    },
  };
}

/**
 * Generate migration checklist from audit report
 */
export function generateMigrationChecklist(
  report: DetailedAuditReport,
): MigrationChecklist {
  const steps: MigrationStep[] = [];
  let stepNumber = 1;

  for (const [fileKey, issues] of Object.entries(report.issuesByFile)) {
    const [profile, file] = fileKey.split('/');

    for (const issue of issues) {
      const grepCommand = `grep -n "${issue.entry}" "${issue.filePath}"`;
      const verificationCommand = `grep "${issue.entry}" "${issue.filePath}" || echo "Successfully removed"`;

      const removalInstructions = [
        `Open file: ${issue.filePath}`,
        `Find the entry: "${issue.entry}" (lines: ${issue.lineNumbers.join(', ')})`,
        `Remove the entire entry definition`,
        `Verify with: ${verificationCommand}`,
      ];

      if (issue.entryType === 'intent_route') {
        removalInstructions[1] = `Find the intent route for "${issue.entry}" at lines ${issue.lineNumbers.join(', ')}`;
        removalInstructions[2] = `Delete the line: "${issue.entry}": { ... }`;
      } else if (issue.entryType === 'keyword') {
        removalInstructions[1] = `Find the keyword entry for "${issue.entry}" at lines ${issue.lineNumbers.join(', ')}`;
        removalInstructions[2] = `Remove the entire keyword definition block`;
      }

      steps.push({
        stepNumber,
        profile,
        file,
        filePath: issue.filePath,
        entry: issue.entry,
        issue: issue.description,
        grepCommand,
        removalInstructions,
        verificationCommand,
      });

      stepNumber++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totalSteps: steps.length,
    steps,
  };
}

/**
 * Format audit report as markdown
 */
export function formatAuditReportMarkdown(report: DetailedAuditReport): string {
  let md = `# Profile Data Audit Report\n\n`;
  md += `**Generated:** ${new Date(report.timestamp).toLocaleString()}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Total Issues Found | ${report.totalIssues} |\n`;
  md += `| Profiles Analyzed | ${report.profilesAnalyzed.length} |\n`;
  md += `| Files Analyzed | ${report.summary.totalFiles} |\n`;
  md += `| Affected Files | ${report.summary.affectedFiles} |\n`;
  md += `| High Confidence Issues | ${report.summary.highConfidenceIssues} |\n\n`;

  md += `## Issues by Profile\n\n`;
  for (const [profile, issues] of Object.entries(report.issuesByProfile)) {
    md += `### ${PROFILE_LABELS[profile]} (${profile})\n\n`;
    md += `Issues found: **${issues.length}**\n\n`;

    for (const issue of issues) {
      md += `- **${issue.entry}** (${issue.entryType})\n`;
      md += `  - Location: \`${issue.file}:${issue.lineNumbers.join(', ')}\`\n`;
      md += `  - Occurrences: ${issue.occurrenceCount}\n`;
      md += `  - Confidence: ${(issue.confidence * 100).toFixed(0)}%\n`;
      md += `  - Issue: ${issue.description}\n`;
      md += `  - Source: ${PROFILE_LABELS[issue.contaminantProfile]}\n\n`;
    }
  }

  md += `## Files Affected\n\n`;
  for (const [fileKey, issues] of Object.entries(report.issuesByFile)) {
    md += `### ${fileKey}\n\n`;
    md += `Contaminated entries: ${issues.length}\n\n`;
    md += `\`\`\`bash\n`;
    md += `# View all issues in this file:\n`;
    md += `grep -n "${issues.map(i => i.entry).join('|')}" "${issues[0].filePath}"\n`;
    md += `\`\`\`\n\n`;
  }

  return md;
}

/**
 * Format migration checklist as markdown
 */
export function formatMigrationChecklistMarkdown(checklist: MigrationChecklist): string {
  let md = `# Profile Data Migration Checklist\n\n`;
  md += `**Generated:** ${new Date(checklist.generatedAt).toLocaleString()}\n`;
  md += `**Total Steps:** ${checklist.totalSteps}\n\n`;

  md += `## Overview\n\n`;
  md += `This checklist provides step-by-step instructions to remove contaminated keywords from profile data files.\n`;
  md += `Each step includes grep commands to verify the fix was applied correctly.\n\n`;

  md += `## Migration Steps\n\n`;

  for (const step of checklist.steps) {
    md += `### Step ${step.stepNumber}: ${step.issue}\n\n`;
    md += `**Profile:** ${PROFILE_LABELS[step.profile]}\n`;
    md += `**File:** \`${step.filePath}\`\n\n`;

    md += `**Removal Instructions:**\n\n`;
    for (const instruction of step.removalInstructions) {
      md += `${step.removalInstructions.indexOf(instruction) + 1}. ${instruction}\n`;
    }
    md += `\n`;

    md += `**Grep Command (to locate):**\n\n`;
    md += `\`\`\`bash\n`;
    md += `${step.grepCommand}\n`;
    md += `\`\`\`\n\n`;

    md += `**Verification Command (after removal):**\n\n`;
    md += `\`\`\`bash\n`;
    md += `${step.verificationCommand}\n`;
    md += `\`\`\`\n\n`;

    md += `---\n\n`;
  }

  md += `## Verification Checklist\n\n`;
  md += `After completing all steps, run these commands to verify clean state:\n\n`;
  md += `\`\`\`bash\n`;
  md += `# Check all profiles are clean\n`;
  for (const profile of Object.keys(PROFILE_DIRS)) {
    const dataDir = PROFILE_DIRS[profile];
    if (fs.existsSync(dataDir)) {
      md += `grep -E "checkout_procedure|late_checkout|card_locked|capsule_conflict" "${dataDir}/routing.json" || echo "${profile} is clean"\n`;
    }
  }
  md += `\`\`\`\n\n`;

  return md;
}

export default {
  generateAuditReport,
  generateMigrationChecklist,
  formatAuditReportMarkdown,
  formatMigrationChecklistMarkdown,
};
