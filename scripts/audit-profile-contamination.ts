#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';

// Profile configuration
const PROFILE_CONFIG = {
  makan: {
    dir: 'src/assistant/data-makan',
    label: 'Makan Moments',
    ownedIntents: [
      'menu_query', 'order_placement', 'food_recommendation',
      'pricing', 'complaint', 'accessibility'
    ],
    keywords: ['menu', 'order', 'food', 'dish', 'meal', 'price', 'cafe', 'restaurant']
  },
  pelangi: {
    dir: 'src/assistant/data-pms-capsule',
    label: 'Pelangi Capsule',
    ownedIntents: [
      'booking', 'check_in_arrival', 'checkin_info', 'checkout_info', 'checkout_now',
      'room_type_preference', 'facilities_info', 'wifi', 'card_locked'
    ],
    keywords: ['room', 'booking', 'check', 'bed', 'hostel', 'capsule', 'guest', 'checkout']
  },
  southern: {
    dir: 'src/assistant/data-southern',
    label: 'Southern Homestay',
    ownedIntents: [
      'booking', 'check_in_arrival', 'checkin_info', 'checkout_info', 'checkout_now',
      'room_type_preference', 'facilities_info', 'wifi', 'local_services', 'prolong_stay'
    ],
    keywords: ['room', 'booking', 'check', 'homestay', 'guest', 'local', 'area']
  },
  pms_southern: {
    dir: 'src/assistant/data-pms-southern',
    label: 'PMS Southern',
    ownedIntents: [
      'booking', 'check_in_arrival', 'checkin_info', 'checkout_info', 'checkout_now'
    ],
    keywords: ['room', 'booking', 'check', 'homestay']
  }
};

interface Violation {
  profile: string;
  file: string;
  entry: string;
  entryType: string;
  contaminantKeywords: string[];
  confidence: number;
  suggestedRemoval: boolean;
  description: string;
}

interface AuditReport {
  timestamp: string;
  totalViolations: number;
  violationsByProfile: Record<string, Violation[]>;
  violationsByFile: Record<string, Violation[]>;
}

interface CleanupLog {
  timestamp: string;
  action: string;
  profile: string;
  file: string;
  entry: string;
  entryType: string;
  reason: string;
}

async function loadJsonFile(filePath: string): Promise<any> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

async function saveJsonFile(filePath: string, data: any): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function detectKeywordContamination(
  text: string,
  profileKeywords: string[],
  otherProfiles: Record<string, string[]>
): { keywords: string[]; confidence: number; profile: string } | null {
  let maxConfidence = 0;
  let contaminantProfile = '';
  let contaminantKeywords: string[] = [];

  for (const [profile, keywords] of Object.entries(otherProfiles)) {
    const matchedKeywords = keywords.filter(kw =>
      text.toLowerCase().includes(kw.toLowerCase())
    );

    if (matchedKeywords.length > 0) {
      const confidence = matchedKeywords.length / keywords.length;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        contaminantProfile = profile;
        contaminantKeywords = matchedKeywords;
      }
    }
  }

  if (maxConfidence > 0.2) {
    return {
      keywords: contaminantKeywords,
      confidence: maxConfidence,
      profile: contaminantProfile
    };
  }

  return null;
}

async function auditProfile(
  profileKey: string,
  config: typeof PROFILE_CONFIG[keyof typeof PROFILE_CONFIG]
): Promise<Violation[]> {
  const violations: Violation[] = [];
  const otherProfiles: Record<string, string[]> = {};

  // Build other profiles' keywords
  for (const [key, cfg] of Object.entries(PROFILE_CONFIG)) {
    if (key !== profileKey) {
      otherProfiles[key] = cfg.keywords;
    }
  }

  // Check routing.json
  const routingPath = path.join(config.dir, 'routing.json');
  const routing = await loadJsonFile(routingPath);

  if (routing && typeof routing === 'object') {
    for (const intent of Object.keys(routing)) {
      // Skip common intents (greeting, thanks, contact_staff, unknown, directions)
      if (['greeting', 'thanks', 'contact_staff', 'unknown', 'directions', 'cancel_workflow'].includes(intent)) {
        continue;
      }

      if (!config.ownedIntents.includes(intent)) {
        const contamination = detectKeywordContamination(intent, config.keywords, otherProfiles);
        if (contamination) {
          violations.push({
            profile: profileKey,
            file: 'routing.json',
            entry: intent,
            entryType: 'intent_route',
            contaminantKeywords: contamination.keywords,
            confidence: contamination.confidence,
            suggestedRemoval: contamination.confidence > 0.5,
            description: `Intent '${intent}' appears to belong to ${contamination.profile} profile`
          });
        }
      }
    }
  }

  // Check knowledge.json
  const knowledgePath = path.join(config.dir, 'knowledge.json');
  const knowledge = await loadJsonFile(knowledgePath);

  if (knowledge && Array.isArray(knowledge.responses)) {
    for (const entry of knowledge.responses) {
      const text = `${entry.intent || ''} ${entry.answer || ''}`.toLowerCase();
      const contamination = detectKeywordContamination(text, config.keywords, otherProfiles);

      if (contamination && contamination.confidence > 0.3) {
        violations.push({
          profile: profileKey,
          file: 'knowledge.json',
          entry: entry.intent || 'unknown',
          entryType: 'knowledge_entry',
          contaminantKeywords: contamination.keywords,
          confidence: contamination.confidence,
          suggestedRemoval: contamination.confidence > 0.6,
          description: `Knowledge entry contains ${contamination.profile} keywords`
        });
      }
    }
  }

  return violations;
}

async function main() {
  const fix = process.argv.includes('--fix');
  const allViolations: Violation[] = [];
  const cleanupLog: CleanupLog[] = [];

  console.log('🔍 Auditing profile data contamination...\n');

  // Audit each profile
  for (const [key, config] of Object.entries(PROFILE_CONFIG)) {
    if (!fs.existsSync(config.dir)) {
      continue;
    }

    console.log(`Scanning ${config.label} (${key})...`);
    const violations = await auditProfile(key, config);

    for (const violation of violations) {
      allViolations.push(violation);

      if (fix && violation.suggestedRemoval) {
        // Apply fix
        if (violation.file === 'routing.json') {
          const filePath = path.join(config.dir, 'routing.json');
          const routing = await loadJsonFile(filePath);
          if (routing && routing[violation.entry]) {
            delete routing[violation.entry];
            await saveJsonFile(filePath, routing);

            cleanupLog.push({
              timestamp: new Date().toISOString(),
              action: 'remove_intent',
              profile: key,
              file: 'routing.json',
              entry: violation.entry,
              entryType: 'intent_route',
              reason: `Contaminated from ${violation.contaminantKeywords.join(', ')}`
            });

            console.log(`  ✓ Removed intent '${violation.entry}' from routing.json`);
          }
        } else if (violation.file === 'knowledge.json') {
          const filePath = path.join(config.dir, 'knowledge.json');
          const knowledge = await loadJsonFile(filePath);
          if (knowledge && Array.isArray(knowledge.responses)) {
            const originalLength = knowledge.responses.length;
            knowledge.responses = knowledge.responses.filter(
              (r: any) => r.intent !== violation.entry
            );

            if (knowledge.responses.length < originalLength) {
              await saveJsonFile(filePath, knowledge);
              cleanupLog.push({
                timestamp: new Date().toISOString(),
                action: 'remove_knowledge_entry',
                profile: key,
                file: 'knowledge.json',
                entry: violation.entry,
                entryType: 'knowledge_entry',
                reason: `Contaminated with ${violation.contaminantKeywords.join(', ')}`
              });

              console.log(`  ✓ Removed knowledge entry for '${violation.entry}'`);
            }
          }
        }
      }
    }

    if (violations.length > 0) {
      console.log(`  Found ${violations.length} contaminations\n`);
    }
  }

  // Generate report
  const report: AuditReport = {
    timestamp: new Date().toISOString(),
    totalViolations: allViolations.length,
    violationsByProfile: {},
    violationsByFile: {}
  };

  for (const violation of allViolations) {
    if (!report.violationsByProfile[violation.profile]) {
      report.violationsByProfile[violation.profile] = [];
    }
    report.violationsByProfile[violation.profile].push(violation);

    const fileKey = `${violation.profile}/${violation.file}`;
    if (!report.violationsByFile[fileKey]) {
      report.violationsByFile[fileKey] = [];
    }
    report.violationsByFile[fileKey].push(violation);
  }

  // Save reports
  if (!fs.existsSync('audit')) {
    fs.mkdirSync('audit', { recursive: true });
  }

  await saveJsonFile('audit/profile-contamination-report.json', report);

  if (fix && cleanupLog.length > 0) {
    await saveJsonFile('audit/profile-cleanup-log.json', cleanupLog);
    console.log(`\n✅ Cleanup completed. ${cleanupLog.length} entries removed.`);
    console.log('📝 Changes logged to audit/profile-cleanup-log.json');
  }

  // Print summary
  console.log(`\n📊 Audit Summary:`);
  console.log(`Total violations found: ${allViolations.length}`);

  for (const [profile, violations] of Object.entries(report.violationsByProfile)) {
    console.log(`  ${profile}: ${violations.length} violations`);
  }

  // Exit with appropriate code
  if (allViolations.some(v => v.confidence > 0.7)) {
    console.log(
      '\n⚠️  High-confidence contaminations detected. Review before committing.'
    );
  }

  await saveJsonFile('audit/profile-contamination-report.json', report);
}

main().catch(console.error);
