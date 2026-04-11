/**
 * CLI script to detect intent classification drift per profile
 * Outputs JSON report with baseline comparison and alert status
 */
import { detectIntentDrift } from '../src/monitoring/profile-intent-drift.js';

async function main() {
  const args = process.argv.slice(2);
  let profile = 'pelangi';
  let threshold = 0.05;

  // Parse command-line arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && i + 1 < args.length) {
      profile = args[i + 1];
      i++;
    } else if (args[i] === '--threshold' && i + 1 < args.length) {
      threshold = parseFloat(args[i + 1]);
      i++;
    }
  }

  try {
    const report = await detectIntentDrift(profile, threshold);
    console.log(JSON.stringify(report, null, 2));

    // Exit with code 1 if alert triggered, 0 otherwise
    process.exit(report.alert_triggered ? 1 : 0);
  } catch (error) {
    console.error('Error detecting drift:', error);
    process.exit(1);
  }
}

main();
