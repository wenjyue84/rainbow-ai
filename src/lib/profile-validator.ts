import fs from "fs";
import path from "path";

export interface ValidationError {
  profile: string;
  file: string;
  line: number;
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export async function validateProfileIsolation(profileDir: string): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  try {
    const profileDirs = getProfileDirs(profileDir);

    for (const profile of profileDirs) {
      const profilePath = path.join(profileDir, profile);
      const intentsPath = path.join(profilePath, "intents.json");
      const keywordsPath = path.join(profilePath, "intent-keywords.json");
      const knowledgePath = path.join(profilePath, "knowledge.json");

      const validIntents = getValidIntents(intentsPath);

      if (fs.existsSync(keywordsPath)) {
        const keywordErrors = validateKeywordFile(profile, keywordsPath, validIntents);
        errors.push(...keywordErrors);
      }

      if (fs.existsSync(knowledgePath)) {
        const knowledgeErrors = validateKnowledgeFile(profile, knowledgePath);
        errors.push(...knowledgeErrors);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [
        {
          profile: "system",
          file: "unknown",
          line: 0,
          message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

function getProfileDirs(parentDir: string): string[] {
  try {
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("data-"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function getValidIntents(intentsPath: string): Set<string> {
  const validIntents = new Set<string>();

  try {
    const content = fs.readFileSync(intentsPath, "utf-8");
    const data = JSON.parse(content);

    if (data.categories && Array.isArray(data.categories)) {
      for (const category of data.categories) {
        if (category.intents && Array.isArray(category.intents)) {
          for (const intent of category.intents) {
            if (intent.category) {
              validIntents.add(intent.category);
            }
          }
        }
      }
    } else if (data.intents && Array.isArray(data.intents)) {
      for (const intent of data.intents) {
        if (intent.intent) {
          validIntents.add(intent.intent);
        }
      }
    }
  } catch {
    // empty
  }

  return validIntents;
}

function validateKeywordFile(profile: string, keywordsPath: string, validIntents: Set<string>): ValidationError[] {
  const errors: ValidationError[] = [];

  try {
    const content = fs.readFileSync(keywordsPath, "utf-8");
    const data = JSON.parse(content);

    if (!data.intents || !Array.isArray(data.intents)) {
      return errors;
    }

    for (const intentEntry of data.intents) {
      if (!intentEntry.intent) continue;

      const intentId = intentEntry.intent;

      if (!validIntents.has(intentId)) {
        errors.push({
          profile,
          file: path.basename(keywordsPath),
          line: 0,
          message: `keyword entry references intent '${intentId}' not found in ${profile}/intents.json`,
        });
      }
    }
  } catch (error) {
    errors.push({
      profile,
      file: path.basename(keywordsPath),
      line: 0,
      message: `Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return errors;
}

function validateKnowledgeFile(profile: string, knowledgePath: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!profile.includes("makan") && !profile.includes("southern")) {
    return errors;
  }

  try {
    const content = fs.readFileSync(knowledgePath, "utf-8");
    const data = JSON.parse(content);
    const contentStr = JSON.stringify(data).toLowerCase();

    const pelangiMarkers = [
      "pelangi",
      "capsule",
      "hostel",
      "jalan desa",
      "petaling jaya",
      "selangor",
      "kuala lumpur",
    ];

    for (const marker of pelangiMarkers) {
      if (contentStr.includes(marker)) {
        errors.push({
          profile,
          file: path.basename(knowledgePath),
          line: 0,
          message: `knowledge.json contains Pelangi-specific content: '${marker}'`,
        });
      }
    }
  } catch (error) {
    errors.push({
      profile,
      file: path.basename(knowledgePath),
      line: 0,
      message: `Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return errors;
}

/**
 * Main API for US-044: Profile data schema validation
 * Returns a report object with isClean flag and detailed errors
 */
export interface ProfileValidationReport {
  isClean: boolean;
  errors: ValidationError[];
}

/**
 * Validate all profiles in base directory
 * Used by src/index.ts for startup validation
 */
export function validateAllProfiles(baseDir: string): ProfileValidationReport {
  const assistantDir = path.join(baseDir, "src", "assistant");
  const validationResult = validateProfileIsolationSync(assistantDir);
  return {
    isClean: validationResult.isValid,
    errors: validationResult.errors,
  };
}

/**
 * Synchronous version of validateProfileIsolation
 */
function validateProfileIsolationSync(profileDir: string): ValidationResult {
  const errors: ValidationError[] = [];

  try {
    const profileDirs = getProfileDirs(profileDir);

    for (const profile of profileDirs) {
      const profilePath = path.join(profileDir, profile);
      const intentsPath = path.join(profilePath, "intents.json");
      const keywordsPath = path.join(profilePath, "intent-keywords.json");
      const knowledgePath = path.join(profilePath, "knowledge.json");

      const validIntents = getValidIntents(intentsPath);

      if (fs.existsSync(keywordsPath)) {
        const keywordErrors = validateKeywordFile(profile, keywordsPath, validIntents);
        errors.push(...keywordErrors);
      }

      if (fs.existsSync(knowledgePath)) {
        const knowledgeErrors = validateKnowledgeFile(profile, knowledgePath);
        errors.push(...knowledgeErrors);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [
        {
          profile: "system",
          file: "unknown",
          line: 0,
          message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

/**
 * Format validation report for logging
 */
export function formatReport(report: ProfileValidationReport): string {
  if (report.isClean) {
    return "✓ All profiles are clean";
  }

  const lines: string[] = [];
  const groupedByProfile: Record<string, ValidationError[]> = {};

  for (const error of report.errors) {
    if (!groupedByProfile[error.profile]) {
      groupedByProfile[error.profile] = [];
    }
    groupedByProfile[error.profile].push(error);
  }

  for (const [profile, errors] of Object.entries(groupedByProfile)) {
    lines.push(`  ${profile}:`);
    for (const error of errors) {
      const location = error.line > 0 ? `:${error.line}` : "";
      lines.push(`    ${error.file}${location}: ${error.message}`);
    }
  }

  return lines.join("\n");
}

/**
 * Enforce schema version compatibility for a profile
 * All JSON files in a profile should have matching schema_version
 */
export function enforceProfileDataVersionCompatibility(profileName: string, baseDir: string): void {
  const assistantDir = path.join(baseDir, "src", "assistant");
  const profileMap: Record<string, string> = {
    pelangi: "data",
    makan: "data-makan",
    southern: "data-southern",
    pms_capsule: "data-pms-capsule",
    pms_southern: "data-pms-southern",
  };

  const profileDir = profileMap[profileName] || "data";
  const fullPath = path.join(assistantDir, profileDir);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Profile directory not found: ${fullPath}`);
  }

  const jsonFiles = fs
    .readdirSync(fullPath)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(fullPath, f));

  let baselineVersion: string | undefined;

  for (const filePath of jsonFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);
      const version = data.schema_version;

      // Skip files without an explicit schema_version field
      if (version === undefined || version === null) {
        continue;
      }

      // Normalize to major.minor for comparison (e.g. "1.0" == "1.0.0")
      const normalizedVersion = String(version).split(".").slice(0, 2).join(".");

      if (baselineVersion === undefined) {
        baselineVersion = normalizedVersion;
      } else if (normalizedVersion !== baselineVersion) {
        throw new Error(
          `${path.basename(filePath)} has schema_version "${version}" but expected "${baselineVersion}"`
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("schema_version")) {
        throw error;
      }
      // Ignore parse errors for now
    }
  }
}
