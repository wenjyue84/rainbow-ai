/**
 * Unit tests for ProfileIsolationValidator (US-536)
 *
 * Tests the ProfileIsolationValidator with synthetic KB files:
 * - Clean profile: no cross-profile contamination
 * - Contaminated profile: ~8% pelangi references in makan KB
 * - Threshold detection: >5% warning, >10% error
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  ProfileIsolationValidator,
  type AuditReport,
} from '../../src/tools/audit/profile-isolation-validator.js';

// ─── Synthetic KB Content ─────────────────────────────────────────────

// Clean makan KB files — cafe-only content, no hostel/homestay keywords
const CLEAN_MAKAN_FILES: Record<string, string> = {
  'menu.md': `# Menu

Our cafe serves a wide variety of dishes and beverages.

## Breakfast
- Nasi Lemak - RM8.90
- Roti Canai - RM3.50

## Lunch
- Chicken Rice - RM10.90
- Mee Goreng - RM7.50

## Beverages
- Teh Tarik - RM3.00
- Kopi O - RM2.50
`,
  'ordering.md': `# How to Order

1. Browse our menu above
2. Place your order at the counter
3. Wait for your number to be called
4. Enjoy your meal!

Takeaway and dine-in options available.
`,
  'faq.md': `# Frequently Asked Questions

**Q: What are your opening hours?**
A: We are open from 8am to 10pm daily.

**Q: Do you offer delivery?**
A: Yes, we offer delivery within 5km radius.

**Q: Can I make a reservation?**
A: Table reservations available for groups of 6 or more.
`,
  'promotions.md': `# Current Promotions

- Buy 1 Free 1 on all beverages (weekday lunch)
- 10% discount for students with valid ID
- Free dessert with any main course purchase above RM20
`,
};

// Contaminated makan KB files — contains pelangi hostel references (~8% contamination)
// 12 files total: 1 contaminated file = ~8.3%
const CONTAMINATED_MAKAN_FILES: Record<string, string> = {
  'menu.md': CLEAN_MAKAN_FILES['menu.md'],
  'ordering.md': CLEAN_MAKAN_FILES['ordering.md'],
  'faq.md': CLEAN_MAKAN_FILES['faq.md'],
  'promotions.md': CLEAN_MAKAN_FILES['promotions.md'],
  'about.md': `# About Makan Moments

We are a local cafe serving authentic Malaysian cuisine.
Located in the heart of town, we pride ourselves on fresh ingredients.
`,
  'delivery.md': `# Delivery Info

We deliver within 5km radius. Minimum order RM20.
Delivery fee: RM3 flat rate.
`,
  'catering.md': `# Catering Services

We offer catering for events and parties.
Minimum 20 pax. Contact us for menu options.
`,
  'reviews.md': `# Customer Reviews

"Best nasi lemak in town!" - Sarah
"Love the ambiance and food quality" - Ahmad
`,
  'allergens.md': `# Allergen Information

We take food allergies seriously.
Please inform our staff of any dietary requirements.
`,
  'location.md': `# Our Location

123 Jalan Makan, Johor Bahru.
Near the main bus terminal.
`,
  'staff.md': `# Our Team

Chef Ahmad - Head Chef
Lisa - Floor Manager
`,
  // THIS FILE is contaminated with pelangi hostel keywords
  'contaminated-copy.md': `# Guest Information

Welcome to our hostel. Your capsule is ready for check-in.
Please collect your key card from the front desk.
The dorm area has shared bathroom facilities.
Pelangi Capsule Hostel provides locker storage for all guests.
Quiet hours are from 10pm to 7am in the bunk bed area.
`,
};

// Clean southern KB files — uses only words NOT in any other profile's keyword list
const CLEAN_SOUTHERN_FILES: Record<string, string> = {
  'info.md': `# About Us

A cozy 3-bedroom place perfect for family getaways.
Located in a peaceful residential area with garden views.
Ideal for weekend trips and holiday stays.
`,
  'directions.md': `# How to Find Us

Take the North-South highway, exit at Senai.
Follow signs to Taman Nusa Bestari.
Our place is the third on the right.
`,
  'policies.md': `# Policies

- No smoking indoors
- Respect neighbors after 10pm
- Maximum 8 visitors
- No animals allowed
`,
};

// ─── Test Helpers ─────────────────────────────────────────────────────

let tempDir: string;
let cleanMakanDir: string;
let contaminatedMakanDir: string;
let cleanSouthernDir: string;

function writeSyntheticKB(dir: string, files: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-isolation-test-'));
  cleanMakanDir = path.join(tempDir, 'clean-makan');
  contaminatedMakanDir = path.join(tempDir, 'contaminated-makan');
  cleanSouthernDir = path.join(tempDir, 'clean-southern');

  writeSyntheticKB(cleanMakanDir, CLEAN_MAKAN_FILES);
  writeSyntheticKB(contaminatedMakanDir, CONTAMINATED_MAKAN_FILES);
  writeSyntheticKB(cleanSouthernDir, CLEAN_SOUTHERN_FILES);
});

afterAll(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─── Tests ────────────────────────────────────────────────────────────

describe('ProfileIsolationValidator', () => {
  describe('audit() with clean profile', () => {
    it('should return clean status for makan KB with no cross-profile contamination', async () => {
      const report = await ProfileIsolationValidator.audit('makan-moments', cleanMakanDir);

      expect(report.profileId).toBe('makan-moments');
      expect(report.overallStatus).toBe('clean');
      expect(report.contaminatedFiles).toBe(0);
      expect(report.contaminationPercentage).toBe(0);
      expect(report.totalFiles).toBe(Object.keys(CLEAN_MAKAN_FILES).length);
    });

    it('should return clean status for southern KB with no cross-profile contamination', async () => {
      const report = await ProfileIsolationValidator.audit('southern', cleanSouthernDir);

      expect(report.overallStatus).toBe('clean');
      expect(report.contaminatedFiles).toBe(0);
    });
  });

  describe('audit() with contaminated profile', () => {
    it('should detect pelangi references in makan KB', async () => {
      const report = await ProfileIsolationValidator.audit('makan-moments', contaminatedMakanDir);

      expect(report.contaminatedFiles).toBeGreaterThan(0);
      expect(report.contaminationPercentage).toBeGreaterThan(0);
      expect(report.contaminationDetails.length).toBeGreaterThan(0);
    });

    it('should identify pelangi as the contaminating profile', async () => {
      const report = await ProfileIsolationValidator.audit('makan-moments', contaminatedMakanDir);

      const pelangiContamination = report.contaminationDetails.find(
        d => d.contaminatingProfile === 'pelangi'
      );

      expect(pelangiContamination).toBeDefined();
      expect(pelangiContamination!.matchedKeywords.length).toBeGreaterThan(0);
      expect(pelangiContamination!.affectedFiles).toContain('contaminated-copy.md');
    });

    it('should detect hostel-specific keywords in the contaminated file', async () => {
      const report = await ProfileIsolationValidator.audit('makan-moments', contaminatedMakanDir);

      const pelangiContamination = report.contaminationDetails.find(
        d => d.contaminatingProfile === 'pelangi'
      );

      expect(pelangiContamination).toBeDefined();
      // The contaminated file contains: hostel, capsule, pelangi, key card, dorm, locker, bunk
      const matchedKws = pelangiContamination!.matchedKeywords.map(k => k.toLowerCase());
      expect(matchedKws).toContain('hostel');
      expect(matchedKws).toContain('capsule');
      expect(matchedKws).toContain('pelangi');
    });

    it('should report contamination percentage reflecting ~8% file contamination', async () => {
      const report = await ProfileIsolationValidator.audit('makan-moments', contaminatedMakanDir);

      // 1 contaminated file out of 12 total = ~8.3%
      // The validator calculates per-profile contamination as affected files / total files
      const pelangiContamination = report.contaminationDetails.find(
        d => d.contaminatingProfile === 'pelangi'
      );

      expect(pelangiContamination).toBeDefined();
      expect(pelangiContamination!.contaminationPercentage).toBeGreaterThanOrEqual(5);
      expect(pelangiContamination!.contaminationPercentage).toBeLessThanOrEqual(15);
    });
  });

  describe('checkThresholds()', () => {
    it('should return hasWarning=false, hasError=false for clean reports', async () => {
      const cleanReport = await ProfileIsolationValidator.audit('makan-moments', cleanMakanDir);
      const { hasWarning, hasError } = ProfileIsolationValidator.checkThresholds([cleanReport]);

      expect(hasWarning).toBe(false);
      expect(hasError).toBe(false);
    });

    it('should detect warning/error thresholds from contaminated reports', async () => {
      const contamReport = await ProfileIsolationValidator.audit('makan-moments', contaminatedMakanDir);

      // The report should trigger at least a warning (>5% contamination from pelangi)
      expect(contamReport.overallStatus).not.toBe('clean');
    });
  });

  describe('auditAll()', () => {
    it('should audit multiple profiles and return all reports', async () => {
      const reports = await ProfileIsolationValidator.auditAll([
        { id: 'makan-moments', kbPath: cleanMakanDir },
        { id: 'southern', kbPath: cleanSouthernDir },
      ]);

      expect(reports).toHaveLength(2);
      expect(reports[0].profileId).toBe('makan-moments');
      expect(reports[1].profileId).toBe('southern');
    });

    it('should report mixed results when one profile is clean and one is contaminated', async () => {
      const reports = await ProfileIsolationValidator.auditAll([
        { id: 'makan-moments', kbPath: contaminatedMakanDir },
        { id: 'southern', kbPath: cleanSouthernDir },
      ]);

      const makanReport = reports.find(r => r.profileId === 'makan-moments');
      const southernReport = reports.find(r => r.profileId === 'southern');

      expect(makanReport!.contaminatedFiles).toBeGreaterThan(0);
      expect(southernReport!.contaminatedFiles).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle non-existent KB path gracefully', async () => {
      const report = await ProfileIsolationValidator.audit('makan-moments', '/nonexistent/path');

      expect(report.totalFiles).toBe(0);
      expect(report.overallStatus).toBe('clean');
    });

    it('should handle empty KB directory', async () => {
      const emptyDir = path.join(tempDir, 'empty-kb');
      fs.mkdirSync(emptyDir, { recursive: true });

      const report = await ProfileIsolationValidator.audit('makan-moments', emptyDir);

      expect(report.totalFiles).toBe(0);
      expect(report.overallStatus).toBe('clean');
    });
  });
});
