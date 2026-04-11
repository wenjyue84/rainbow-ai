#!/usr/bin/env tsx

/**
 * US-493: Profile Audit CLI
 *
 * Usage: tsx src/tools/profile-audit-generator-cli.ts --audit-all
 * Generates:
 * - profile-audit-report.md (detailed contamination report)
 * - profile_migration_checklist.md (step-by-step removal instructions)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateAuditReport,
  generateMigrationChecklist,
  formatAuditReportMarkdown,
  formatMigrationChecklistMarkdown,
} from './profile-audit-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// Parse arguments
const args = process.argv.slice(2);
const auditAll = args.includes('--audit-all');

async function main() {
  if (!auditAll) {
    console.log('Profile Data Audit Report Generator');
    console.log('');
    console.log('Usage: tsx src/tools/profile-audit-generator-cli.ts --audit-all');
    console.log('');
    console.log('This tool audits profile data files for contamination and generates:');
    console.log('  - profile-audit-report.md: Detailed contamination report');
    console.log('  - profile_migration_checklist.md: Step-by-step removal instructions');
    process.exit(0);
  }

  console.log('🔍 Generating profile audit report...\n');

  try {
    // Generate audit report
    const auditReport = generateAuditReport();

    // Format as markdown
    const auditMarkdown = formatAuditReportMarkdown(auditReport);

    // Save audit report
    const auditReportPath = path.join(rootDir, 'profile-audit-report.md');
    fs.writeFileSync(auditReportPath, auditMarkdown, 'utf-8');
    console.log(`✓ Audit report saved: ${auditReportPath}`);

    // Generate migration checklist
    const migrationChecklist = generateMigrationChecklist(auditReport);

    // Format as markdown
    const checklistMarkdown = formatMigrationChecklistMarkdown(migrationChecklist);

    // Save migration checklist
    const checklistPath = path.join(rootDir, 'profile_migration_checklist.md');
    fs.writeFileSync(checklistPath, checklistMarkdown, 'utf-8');
    console.log(`✓ Migration checklist saved: ${checklistPath}`);

    // Save JSON reports for programmatic access
    const auditJsonPath = path.join(rootDir, 'audit', 'profile-audit-report.json');
    const checklistJsonPath = path.join(rootDir, 'audit', 'profile-migration-checklist.json');

    // Ensure audit directory exists
    if (!fs.existsSync(path.join(rootDir, 'audit'))) {
      fs.mkdirSync(path.join(rootDir, 'audit'), { recursive: true });
    }

    fs.writeFileSync(auditJsonPath, JSON.stringify(auditReport, null, 2), 'utf-8');
    console.log(`✓ Audit JSON saved: ${auditJsonPath}`);

    fs.writeFileSync(checklistJsonPath, JSON.stringify(migrationChecklist, null, 2), 'utf-8');
    console.log(`✓ Checklist JSON saved: ${checklistJsonPath}`);

    // Print summary
    console.log(`\n📊 Audit Summary:`);
    console.log(`  Profiles analyzed: ${auditReport.profilesAnalyzed.join(', ')}`);
    console.log(`  Total files analyzed: ${auditReport.summary.totalFiles}`);
    console.log(`  Affected files: ${auditReport.summary.affectedFiles}`);
    console.log(`  Total contamination issues: ${auditReport.totalIssues}`);
    console.log(`  High-confidence issues: ${auditReport.summary.highConfidenceIssues}`);

    if (auditReport.totalIssues > 0) {
      console.log(`\n⚠️  Issues found by profile:`);
      for (const [profile, issues] of Object.entries(auditReport.issuesByProfile)) {
        console.log(`  ${profile}: ${issues.length} issues`);
      }
    } else {
      console.log(`\n✅ No contamination issues detected!`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error generating audit report:');
    console.error(error);
    process.exit(1);
  }
}

main();
