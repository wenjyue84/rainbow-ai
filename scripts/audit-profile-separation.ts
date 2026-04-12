import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ContaminationRules {
  pelangi: string[];
  makan: string[];
  southern: string[];
}

interface Violation {
  term: string;
  file: string;
  lineNumber: number;
  context: string;
}

interface AuditReport {
  profile: string;
  violations: Violation[];
}

async function loadJSON(filePath: string): Promise<any> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

function getProhibitedTerms(profile: string, rules: ContaminationRules): string[] {
  // Each profile should avoid terms from OTHER profiles
  if (profile === "makan") {
    // Makan should avoid Pelangi AND Southern terms
    return [...rules.pelangi, ...rules.southern];
  } else if (profile === "southern") {
    // Southern should avoid Pelangi AND Makan terms
    return [...rules.pelangi, ...rules.makan];
  } else if (profile === "pelangi") {
    // Pelangi can have its own terms, no restrictions for this audit
    return [];
  }
  return [];
}

function scanTextForTerms(text: string, terms: string[]): string[] {
  if (!text) return [];
  const found: string[] = [];
  const lowerText = text.toLowerCase();

  for (const term of terms) {
    const lowerTerm = term.toLowerCase();
    if (lowerText.includes(lowerTerm)) {
      found.push(term);
    }
  }

  return found;
}

function extractContextLine(text: string, term: string, lineNumber: number): string {
  const lines = text.split("\n");
  if (lineNumber > 0 && lineNumber <= lines.length) {
    return lines[lineNumber - 1].substring(0, 100);
  }
  return text.substring(0, 100);
}

function auditFile(
  filePath: string,
  profile: string,
  prohibitedTerms: string[]
): Violation[] {
  const violations: Violation[] = [];

  if (!fs.existsSync(filePath)) {
    return violations;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  lines.forEach((line, lineIndex) => {
    const foundTerms = scanTextForTerms(line, prohibitedTerms);
    foundTerms.forEach((term) => {
      // Avoid duplicate violations for the same term on the same line
      if (
        !violations.some(
          (v) =>
            v.term === term &&
            v.lineNumber === lineIndex + 1 &&
            v.file === filePath
        )
      ) {
        violations.push({
          term,
          file: path.relative(process.cwd(), filePath),
          lineNumber: lineIndex + 1,
          context: extractContextLine(content, term, lineIndex + 1),
        });
      }
    });
  });

  return violations;
}

async function auditProfile(
  profileName: string,
  rules: ContaminationRules
): Promise<AuditReport> {
  const profileDir = path.join(
    process.cwd(),
    "src/assistant",
    profileName === "pelangi" ? "data" : `data-${profileName}`
  );

  const prohibitedTerms = getProhibitedTerms(profileName, rules);
  const violations: Violation[] = [];

  // Audit knowledge.json
  const knowledgePath = path.join(profileDir, "knowledge.json");
  if (fs.existsSync(knowledgePath)) {
    const knowledgeViolations = auditFile(knowledgePath, profileName, prohibitedTerms);
    violations.push(...knowledgeViolations);
  }

  // Audit workflows.json
  const workflowsPath = path.join(profileDir, "workflows.json");
  if (fs.existsSync(workflowsPath)) {
    const workflowViolations = auditFile(workflowsPath, profileName, prohibitedTerms);
    violations.push(...workflowViolations);
  }

  return {
    profile: profileName,
    violations,
  };
}

async function main() {
  const rulesPath = path.join(__dirname, "contamination-rules.json");

  if (!fs.existsSync(rulesPath)) {
    console.error(`Error: contamination-rules.json not found at ${rulesPath}`);
    process.exit(1);
  }

  const rulesContent = fs.readFileSync(rulesPath, "utf-8");
  const rules: ContaminationRules = JSON.parse(rulesContent);

  // Audit the three main profiles
  const profiles = ["makan", "southern"];
  const reports: AuditReport[] = [];
  let hasViolations = false;

  for (const profile of profiles) {
    const report = await auditProfile(profile, rules);
    reports.push(report);
    if (report.violations.length > 0) {
      hasViolations = true;
    }
  }

  // Output JSON report to stdout
  console.log(JSON.stringify(reports, null, 2));

  // Exit with appropriate code
  process.exit(hasViolations ? 1 : 0);
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
