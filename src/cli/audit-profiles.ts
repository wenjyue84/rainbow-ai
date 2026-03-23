import path from "path";
import { validateProfileIsolation } from "../lib/profile-validator.js";

async function main() {
  const profileDir = path.join(process.cwd(), "src/assistant");

  console.log("Validating profile data file integrity...");
  const result = await validateProfileIsolation(profileDir);

  if (result.isValid) {
    console.log("✓ All profiles are clean - no cross-contamination detected");
    process.exit(0);
  } else {
    console.error("✗ Profile validation failed:");
    for (const error of result.errors) {
      const location = error.line > 0 ? `:${error.line}` : "";
      console.error(`  ${error.profile}/${error.file}${location}: ${error.message}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
