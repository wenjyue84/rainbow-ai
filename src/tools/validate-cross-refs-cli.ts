#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url).replace(/\\/g, '/');
const isMain = __filename === process.argv[1].replace(/\\/g, '/');

interface DataFiles {
  routing: Record<string, any>;
  intents: any;
  workflows: any;
  knowledge: any;
}

interface ValidationIssues {
  missing_intents: Array<{ intent: string; file: string; reference: string }>;
  orphaned_knowledge_intents: string[];
  missing_workflow_ids: Array<{ workflow_id: string; routing_intent: string }>;
}

/**
 * Extract all intent names from intents.json
 */
function extractIntentNames(intentsData: any): Set<string> {
  const names = new Set<string>();

  if (intentsData.categories && Array.isArray(intentsData.categories)) {
    for (const cat of intentsData.categories) {
      if (cat.intents && Array.isArray(cat.intents)) {
        for (const intent of cat.intents) {
          if (intent.category) {
            names.add(intent.category);
          }
        }
      }
    }
  }

  return names;
}

/**
 * Extract all workflow IDs from workflows.json
 */
function extractWorkflowIds(workflowsData: any): Set<string> {
  const ids = new Set<string>();

  if (workflowsData.workflows && Array.isArray(workflowsData.workflows)) {
    for (const workflow of workflowsData.workflows) {
      if (workflow.id) {
        ids.add(workflow.id);
      }
    }
  }

  return ids;
}

/**
 * Load all data files for a profile
 */
function loadDataFiles(profileName: string): DataFiles {
  // Normalize profile name
  const normalizedProfile = profileName.startsWith('data-') ? profileName : `data-${profileName}`;
  const basePath = normalizedProfile === 'data-pelangi' ?
    path.resolve(process.cwd(), 'src/assistant/data') :
    path.resolve(process.cwd(), `src/assistant/${normalizedProfile}`);

  const routing = JSON.parse(fs.readFileSync(path.join(basePath, 'routing.json'), 'utf-8'));
  const intents = JSON.parse(fs.readFileSync(path.join(basePath, 'intents.json'), 'utf-8'));
  const workflows = JSON.parse(fs.readFileSync(path.join(basePath, 'workflows.json'), 'utf-8'));
  const knowledge = JSON.parse(fs.readFileSync(path.join(basePath, 'knowledge.json'), 'utf-8'));

  return { routing, intents, workflows, knowledge };
}

/**
 * Analyze cross-references
 */
function analyzeReferences(data: DataFiles): ValidationIssues {
  const issues: ValidationIssues = {
    missing_intents: [],
    orphaned_knowledge_intents: [],
    missing_workflow_ids: []
  };

  const intentNames = extractIntentNames(data.intents);
  const workflowIds = extractWorkflowIds(data.workflows);

  // Check 1: All intent names in routing.json exist in intents.json
  for (const [routingIntent, config] of Object.entries(data.routing)) {
    if (!intentNames.has(routingIntent)) {
      issues.missing_intents.push({
        intent: routingIntent,
        file: 'routing.json',
        reference: `routing.json key "${routingIntent}"`
      });
    }

    // Check 2: All workflow_ids in routing.json exist in workflows.json
    if (typeof config === 'object' && config.action === 'workflow' && config.workflow_id) {
      if (!workflowIds.has(config.workflow_id)) {
        issues.missing_workflow_ids.push({
          workflow_id: config.workflow_id,
          routing_intent: routingIntent
        });
      }
    }
  }

  // Check 3: All knowledge.json intent values exist in intents.json
  if (data.knowledge.static && Array.isArray(data.knowledge.static)) {
    for (const entry of data.knowledge.static) {
      if (entry.intent && !intentNames.has(entry.intent)) {
        issues.orphaned_knowledge_intents.push(entry.intent);
      }
    }
  }

  return issues;
}

/**
 * Backup files before modification
 */
function backupFiles(basePath: string): string {
  const backupDir = path.join(basePath, `.backup-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const files = ['routing.json', 'intents.json', 'workflows.json', 'knowledge.json'];
  for (const file of files) {
    const src = path.join(basePath, file);
    const dst = path.join(backupDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    }
  }

  return backupDir;
}

/**
 * Apply fixes
 */
function applyFixes(profileName: string, data: DataFiles, issues: ValidationIssues, basePath: string): void {
  const normalizedProfile = profileName.startsWith('data-') ? profileName : `data-${profileName}`;

  // Remove orphaned intents from knowledge.json
  if (issues.orphaned_knowledge_intents.length > 0) {
    if (data.knowledge.static && Array.isArray(data.knowledge.static)) {
      data.knowledge.static = data.knowledge.static.filter(
        entry => !issues.orphaned_knowledge_intents.includes(entry.intent)
      );
    }

    fs.writeFileSync(
      path.join(basePath, 'knowledge.json'),
      JSON.stringify(data.knowledge, null, 2)
    );

    console.log(`✓ Removed ${issues.orphaned_knowledge_intents.length} orphaned knowledge entries`);
  }

  // Remove missing intent references from routing.json
  if (issues.missing_intents.length > 0) {
    for (const issue of issues.missing_intents) {
      if (issue.file === 'routing.json') {
        delete data.routing[issue.intent];
      }
    }

    fs.writeFileSync(
      path.join(basePath, 'routing.json'),
      JSON.stringify(data.routing, null, 2)
    );

    console.log(`✓ Removed ${issues.missing_intents.length} missing intent references from routing.json`);
  }
}

/**
 * Main validation function
 */
async function main() {
  const args = process.argv.slice(2);
  const profileIndex = args.indexOf('--profile');
  const fixIndex = args.indexOf('--fix');

  if (profileIndex === -1) {
    console.error('Error: --profile argument required');
    console.error('Usage: npm run validate:cross-refs -- --profile <profile> [--fix]');
    process.exit(1);
  }

  const profileName = args[profileIndex + 1];
  const shouldFix = fixIndex !== -1;

  try {
    const normalizedProfile = profileName.startsWith('data-') ? profileName : `data-${profileName}`;
    const basePath = normalizedProfile === 'data-pelangi' ?
      path.resolve(process.cwd(), 'src/assistant/data') :
      path.resolve(process.cwd(), `src/assistant/${normalizedProfile}`);

    console.log(`Validating cross-references for profile: ${profileName}`);

    const data = loadDataFiles(profileName);
    const issues = analyzeReferences(data);

    const hasIssues =
      issues.missing_intents.length > 0 ||
      issues.orphaned_knowledge_intents.length > 0 ||
      issues.missing_workflow_ids.length > 0;

    if (!hasIssues) {
      console.log('\n✓ No cross-reference issues found');
      process.exit(0);
    }

    // Report issues
    console.log('\n⚠ Issues found:');

    if (issues.missing_intents.length > 0) {
      console.log(`\n  Missing intents (referenced in routing.json but not in intents.json):`);
      for (const issue of issues.missing_intents) {
        console.log(`    - "${issue.intent}" in ${issue.reference}`);
      }
    }

    if (issues.missing_workflow_ids.length > 0) {
      console.log(`\n  Missing workflow IDs (referenced in routing.json but not in workflows.json):`);
      for (const issue of issues.missing_workflow_ids) {
        console.log(`    - "${issue.workflow_id}" referenced from intent "${issue.routing_intent}"`);
      }
    }

    if (issues.orphaned_knowledge_intents.length > 0) {
      console.log(`\n  Orphaned knowledge intents (in knowledge.json but not in intents.json):`);
      for (const intent of issues.orphaned_knowledge_intents) {
        console.log(`    - "${intent}"`);
      }
    }

    // Output JSON format
    const report = {
      profile: profileName,
      has_issues: true,
      missing_intents: issues.missing_intents.map(i => i.intent),
      missing_workflow_ids: issues.missing_workflow_ids.map(w => ({
        workflow_id: w.workflow_id,
        referenced_from: w.routing_intent
      })),
      orphaned_knowledge_intents: issues.orphaned_knowledge_intents
    };

    console.log('\nJSON Report:');
    console.log(JSON.stringify(report, null, 2));

    if (shouldFix) {
      console.log('\n🔧 Applying fixes...');
      const backupPath = backupFiles(basePath);
      console.log(`✓ Backed up files to: ${backupPath}`);

      applyFixes(profileName, data, issues, basePath);
      console.log('✓ Fixes applied. Review changes before committing.');
    }

    process.exit(1);
  } catch (error) {
    console.error('Error during validation:', error);
    process.exit(1);
  }
}

if (isMain) {
  main().catch(console.error);
}

export { loadDataFiles, analyzeReferences, extractIntentNames, extractWorkflowIds, applyFixes };
