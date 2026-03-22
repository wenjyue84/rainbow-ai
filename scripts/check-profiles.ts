import { detectContamination, generateContaminationReport } from "../src/lib/profile-contamination-check.js";
import fs from "fs";
import path from "path";

/**
 * CLI script to check all profiles for data contamination
 * Outputs a CSV report to stdout and exits with code 0 if clean, 1 if contamination found
 */
async function main() {
  const profiles = ["pelangi", "makan", "southern"];

  console.log("🔍 Scanning profiles for cross-contamination...\n");

  const results = profiles.map((profile) => detectContamination(profile));

  const report = generateContaminationReport(results);
  console.log(report);
  console.log("\n");

  // Check if any profiles are contaminated
  const hasContamination = results.some((r) => r.contaminated);

  if (hasContamination) {
    console.error("❌ Contamination detected!");
    for (const result of results) {
      if (result.contaminated) {
        console.error(`\n⚠️  Profile '${result.profileName}' has ${result.findings.length} contaminated entries:`);
        for (const finding of result.findings.slice(0, 5)) {
          console.error(
            `   - ${finding.sourceFile}: "${finding.matchedTerm}" in ${finding.context}`
          );
        }
        if (result.findings.length > 5) {
          console.error(`   ... and ${result.findings.length - 5} more`);
        }
      }
    }
    process.exit(1);
  } else {
    console.log("✅ All profiles are clean!");
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
