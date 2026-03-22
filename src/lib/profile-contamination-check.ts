import fs from "fs";
import path from "path";

// Define profile-specific terminology to detect cross-contamination
const HOSTEL_TERMS = [
  "check-in",
  "check in",
  "checkin",
  "daftar masuk",
  "check-out",
  "check out",
  "checkout",
  "daftar keluar",
  "room type",
  "jenis bilik",
  "房间类型",
  "capsule",
  "kapsul",
  "胶囊",
  "dorm",
  "dormitory",
  "guest",
  "tetamu",
  "客人",
  "staying",
  "menginap",
  "住宿",
  "accommodation",
  "akomodasi",
  "住宿",
  "hostel",
  "wisma",
  "旅舍",
  "bed",
  "katil",
  "床",
  "deck",
  "dek",
  "甲板",
  "lower deck",
  "deck bawah",
  "key card",
  "kad kunci",
  "钥匙卡",
  "password",
  "kata laluan",
  "密码",
  "check-in time",
  "check-out time",
  "arrival",
  "ketibaan",
  "到达",
  "departure",
  "keberangkatan",
  "出发",
  "amenities",
  "kemudahan",
  "便利设施",
  "capsule pod",
  "wifi password",
  "internet password",
  "door password",
  "room availability",
  "ketersediaan bilik",
];

const CAFE_TERMS = [
  "menu",
  "makanan",
  "食物",
  "minuman",
  "beverage",
  "makanan",
  "order",
  "pesanan",
  "订单",
  "dine",
  "makan",
  "用餐",
  "dining",
  "restaurant",
  "restoran",
  "餐厅",
  "cafe",
  "kafe",
  "咖啡厅",
  "coffee",
  "kopi",
  "咖啡",
  "nasi lemak",
  "mee goreng",
  "roti canai",
  "teh tarik",
  "kopi o",
  "char kway teow",
  "RM",
  "price",
  "harga",
  "价格",
  "operating hours",
  "waktu operasi",
  "营业时间",
  "breakfast",
  "sarapan",
  "早餐",
  "lunch",
  "makan tengah hari",
  "午餐",
  "dinner",
  "makan malam",
  "晚餐",
  "takeaway",
  "bungkus",
  "外卖",
  "dine-in",
  "makan di sini",
  "堂食",
  "kitchen",
  "dapur",
  "厨房",
  "chef",
  "cook",
  "cook",
  "masakan",
  "dish",
  "hidangan",
  "specialty",
  "spesial",
  "combo",
  "set meal",
  "food court",
  "seating",
  "tempat duduk",
  "座位",
  "restroom",
  "toilet",
  "tandas",
  "restrooms",
  "tandas",
  "self-service",
  "layan diri",
];

interface ContaminationResult {
  profileName: string;
  contaminated: boolean;
  findings: ContaminationFinding[];
}

interface ContaminationFinding {
  sourceFile: string;
  contaminant: string;
  context: string;
  matchedTerm: string;
}

/**
 * Load and parse a JSON file from a profile directory
 */
function loadJsonFile(profilePath: string, fileName: string): unknown {
  const filePath = path.join(profilePath, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error parsing ${fileName}: ${error}`);
    return null;
  }
}

/**
 * Check if a string contains any terms from a list (case-insensitive)
 */
function containsTerms(text: string, terms: string[]): string | null {
  const lowerText = text.toLowerCase();
  for (const term of terms) {
    if (lowerText.includes(term.toLowerCase())) {
      return term;
    }
  }
  return null;
}

/**
 * Detect contamination in knowledge.json
 */
function checkKnowledgeFile(
  profilePath: string,
  profileName: string,
  findings: ContaminationFinding[],
  contaminantTerms: string[]
): void {
  const knowledge = loadJsonFile(
    profilePath,
    "knowledge.json"
  ) as Record<string, unknown> | null;
  if (!knowledge) return;

  const static_array = (knowledge as Record<string, unknown>)
    .static as unknown[];
  if (!Array.isArray(static_array)) return;

  for (const entry of static_array) {
    const obj = entry as Record<string, unknown>;
    const intent = obj.intent as string;
    const response = obj.response as Record<string, string> | undefined;

    if (response) {
      for (const [lang, text] of Object.entries(response)) {
        const matchedTerm = containsTerms(text, contaminantTerms);
        if (matchedTerm) {
          findings.push({
            sourceFile: "knowledge.json",
            contaminant: profileName,
            context: `intent: ${intent} (${lang})`,
            matchedTerm,
          });
        }
      }
    }
  }
}

/**
 * Detect contamination in intent-keywords.json
 */
function checkIntentKeywordsFile(
  profilePath: string,
  profileName: string,
  findings: ContaminationFinding[],
  contaminantTerms: string[]
): void {
  const intentKeywords = loadJsonFile(
    profilePath,
    "intent-keywords.json"
  ) as Record<string, unknown> | null;
  if (!intentKeywords) return;

  const intents_array = (intentKeywords as Record<string, unknown>)
    .intents as unknown[];
  if (!Array.isArray(intents_array)) return;

  for (const entry of intents_array) {
    const obj = entry as Record<string, unknown>;
    const intent = obj.intent as string;
    const keywords = obj.keywords as Record<string, unknown> | undefined;

    if (keywords) {
      for (const [lang, keywordList] of Object.entries(keywords)) {
        if (Array.isArray(keywordList)) {
          for (const keyword of keywordList) {
            const matchedTerm = containsTerms(
              String(keyword),
              contaminantTerms
            );
            if (matchedTerm) {
              findings.push({
                sourceFile: "intent-keywords.json",
                contaminant: profileName,
                context: `intent: ${intent} (${lang})`,
                matchedTerm,
              });
            }
          }
        }
      }
    }
  }
}

/**
 * Detect contamination in routing.json
 */
function checkRoutingFile(
  profilePath: string,
  profileName: string,
  findings: ContaminationFinding[],
  contaminantTerms: string[]
): void {
  const routing = loadJsonFile(profilePath, "routing.json") as Record<
    string,
    unknown
  > | null;
  if (!routing) return;

  for (const [intentKey] of Object.entries(routing)) {
    const matchedTerm = containsTerms(intentKey, contaminantTerms);
    if (matchedTerm) {
      findings.push({
        sourceFile: "routing.json",
        contaminant: profileName,
        context: `intent key: ${intentKey}`,
        matchedTerm,
      });
    }
  }
}

/**
 * Determine which profile type the given profile is
 * Returns 'hostel', 'cafe', or 'unknown'
 */
function getProfileType(profileName: string): "hostel" | "cafe" | "unknown" {
  const lowerName = profileName.toLowerCase();
  if (lowerName.includes("makan") || lowerName.includes("cafe")) {
    return "cafe";
  }
  if (
    lowerName.includes("pelangi") ||
    lowerName.includes("southern") ||
    lowerName.includes("hostel")
  ) {
    return "hostel";
  }
  return "unknown";
}

/**
 * Detect contamination in a profile's data files
 * For hostel profiles: check against CAFE_TERMS (should not contain cafe terms)
 * For cafe profiles: check against HOSTEL_TERMS (should not contain hostel terms)
 */
export function detectContamination(profileName: string): ContaminationResult {
  const dataDir = path.join(process.cwd(), "src", "assistant");
  const profilePath = path.join(dataDir, `data-${profileName}`);

  if (!fs.existsSync(profilePath)) {
    return {
      profileName,
      contaminated: false,
      findings: [],
    };
  }

  const profileType = getProfileType(profileName);
  const findings: ContaminationFinding[] = [];

  // Determine which terms to check for based on profile type
  const contaminantTerms =
    profileType === "cafe" ? HOSTEL_TERMS : CAFE_TERMS;

  // Check all three critical files
  checkKnowledgeFile(profilePath, profileName, findings, contaminantTerms);
  checkIntentKeywordsFile(profilePath, profileName, findings, contaminantTerms);
  checkRoutingFile(profilePath, profileName, findings, contaminantTerms);

  return {
    profileName,
    contaminated: findings.length > 0,
    findings,
  };
}

/**
 * Generate a CSV report of contamination findings
 */
export function generateContaminationReport(
  results: ContaminationResult[]
): string {
  const lines: string[] = [
    "Profile,Contaminated,Source File,Matched Term,Context",
  ];

  for (const result of results) {
    if (result.findings.length === 0) {
      lines.push(`${result.profileName},false,,,,`);
    } else {
      for (const finding of result.findings) {
        const escapedContext = finding.context.replace(/"/g, '""');
        const escapedTerm = finding.matchedTerm.replace(/"/g, '""');
        lines.push(
          `${result.profileName},true,${finding.sourceFile},"${escapedTerm}","${escapedContext}"`
        );
      }
    }
  }

  return lines.join("\n");
}
