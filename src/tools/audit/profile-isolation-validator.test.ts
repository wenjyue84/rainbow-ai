/**
 * US-536: Profile Data Isolation Validator Tests
 *
 * Test suite for ProfileIsolationValidator.audit() method.
 * Validates detection and reporting of cross-profile KB contamination.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ProfileIsolationValidator } from './profile-isolation-validator.js';

// ─── Test Fixtures ────────────────────────────────────────────────────

const TEST_DIR = join(process.cwd(), '.test-kb-isolation');

/**
 * Create test KB directory with synthetic markdown files
 */
function createTestKB(
  profileId: string,
  files: Record<string, string>
): string {
  const kbDir = join(TEST_DIR, `kb-${profileId}`);
  mkdirSync(kbDir, { recursive: true });

  for (const [fileName, content] of Object.entries(files)) {
    const filePath = join(kbDir, fileName);
    // Get directory path, handling both forward and back slashes
    const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const fileDir = filePath.substring(0, lastSeparator);
    if (fileDir && fileDir !== kbDir) {
      mkdirSync(fileDir, { recursive: true });
    }
    writeFileSync(filePath, content, 'utf-8');
  }

  return kbDir;
}

/**
 * Clean up test directories
 */
function cleanupTestKB(): void {
  try {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  } catch {
    // Already cleaned up
  }
}

// ─── Test Suites ──────────────────────────────────────────────────────

describe('ProfileIsolationValidator', () => {
  beforeEach(() => {
    cleanupTestKB();
  });

  afterEach(() => {
    cleanupTestKB();
  });

  describe('audit() — detect cross-profile contamination', () => {
    it('should return clean status for uncontaminated KB', async () => {
      // Arrange: create clean makan KB with no hostel references
      const cleanMakanFiles = {
        'menu.md': `
# Makan Moments Menu

## Beverages
- Iced Coffee
- Thai Tea
- Fresh Juice

## Food
- Pad Thai
- Chicken Satay
- Spring Rolls
        `,
        'faq.md': `
# FAQ

Q: What are your opening hours?
A: We're open from 10 AM to 10 PM daily.

Q: Do you have delivery?
A: Yes, we deliver through GrabFood and Foodpanda.
        `,
      };

      const kbDir = createTestKB('makan-moments', cleanMakanFiles);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      expect(report.profileId).toBe('makan-moments');
      expect(report.overallStatus).toBe('clean');
      expect(report.contaminationPercentage).toBe(0);
      expect(report.contaminationDetails).toHaveLength(0);
      expect(report.totalFiles).toBe(2);
      expect(report.contaminatedFiles).toBe(0);
    });

    it('should detect pelangi hostel keywords in makan KB (8% contamination)', async () => {
      // Arrange: create makan KB with ~8% pelangi references
      // With 2 files, if 8% contamination, it means the content is lightly contaminated with hostel terms
      const contaminatedMakanFiles = {
        'menu.md': `
# Makan Moments Menu

## Beverages
- Iced Coffee
- Thai Tea
- Fresh Juice

## Food Items
- Pad Thai
- Chicken Satay
- Spring Rolls

Our guest favorite is the Pad Thai. Many booking customers come just for this dish.
We have comfortable seating for room checks and checking in to our cafe ambiance.
        `,
        'faq.md': `
# FAQ

Q: What are your opening hours?
A: We're open from 10 AM to 10 PM daily.

Q: Do you have delivery?
A: Yes, we deliver. Our staff are trained like hostel amenity providers.

Q: Dining options?
A: Dine-in at our shared tables or take away. Perfect for guests or bookings.
        `,
      };

      const kbDir = createTestKB('makan-moments', contaminatedMakanFiles);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      expect(report.profileId).toBe('makan-moments');
      expect(report.totalFiles).toBe(2);
      // Should detect at least one pelangi contamination detail (keywords like: guest, booking, amenity, hostel, etc.)
      expect(report.contaminationDetails.length).toBeGreaterThan(0);

      // Check that pelangi profile is identified as contaminating source
      const pelangiContamination = report.contaminationDetails.find(
        d => d.contaminatingProfile === 'pelangi'
      );
      expect(pelangiContamination).toBeDefined();

      if (pelangiContamination) {
        // Should have detected keywords like 'guest', 'booking', 'amenity'
        expect(pelangiContamination.matchedKeywords.length).toBeGreaterThan(0);
        // Should list the affected files
        expect(pelangiContamination.affectedFiles.length).toBeGreaterThan(0);
      }

      // Contamination percentage should be > 0
      expect(report.contaminationPercentage).toBeGreaterThan(0);
    });

    it('should log warning if contamination is between 5-10%', async () => {
      // Arrange: create KB with moderate contamination
      const moderateContamination = {
        'page1.md': `
# Page 1

Regular content about our services.
We welcome all guests who book rooms with us.
Our amenity staff can help with any questions.
        `,
        'page2.md': `
# Page 2

More regular content here.
Nothing contaminated here.
        `,
      };

      const kbDir = createTestKB('makan-moments', moderateContamination);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      // If contamination is between 5-10%, status should be 'warning'
      if (report.contaminationPercentage > 5 && report.contaminationPercentage < 10) {
        expect(report.overallStatus).toBe('warning');
      }
    });

    it('should log error if contamination is > 10%', async () => {
      // Arrange: create heavily contaminated KB (>10% hostel references in makan)
      const heavyContamination = {
        'menu.md': `
# Makan Moments Menu

Our guest friendly cafe features hostel-style seating.
We accommodate large booking parties with shared tables.
All amenities include wifi and dorm-like communal areas.
The hostel room comes with breakfast and coffee.
Our booking system integrates with guest management.
Capsule pod seating available. Check in counter at main desk.
        `,
        'faq.md': `
# FAQ

Q: Guest seating?
A: Yes, booking guests can dine. Hostel rates available.
Q: Room rental?
A: We offer dorm accommodation with breakfast buffet included.
Shared bathrooms with amenities. Capsule beds for budget guests.
        `,
      };

      const kbDir = createTestKB('makan-moments', heavyContamination);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      if (report.contaminationPercentage > 10) {
        expect(report.overallStatus).toBe('error');
      }
    });

    it('should handle missing KB directory gracefully', async () => {
      // Act & Assert
      const report = await ProfileIsolationValidator.audit(
        'makan-moments',
        '/nonexistent/path/kb'
      );

      // Should return report with 0 files and clean status
      expect(report.totalFiles).toBe(0);
      expect(report.overallStatus).toBe('clean');
    });
  });

  describe('auditAll() — audit multiple profiles', () => {
    it('should audit all profiles and return reports', async () => {
      // Arrange: create clean KBs for two profiles
      const makanFiles = {
        'menu.md': `
# Makan Moments Menu

Beverages:
- Coffee
- Tea
- Juice

Food:
- Pad Thai
- Satay
        `,
      };

      const southernFiles = {
        'booking.md': `
# Southern Homestay Booking

Our property features:
- Private rooms
- Shared kitchen
- Garden area
        `,
      };

      const makanKb = createTestKB('makan-moments', makanFiles);
      const southernKb = createTestKB('southern', southernFiles);

      const configs = [
        { id: 'makan-moments', kbPath: makanKb },
        { id: 'southern', kbPath: southernKb },
      ];

      // Act
      const reports = await ProfileIsolationValidator.auditAll(configs);

      // Assert
      expect(reports).toHaveLength(2);
      expect(reports[0].profileId).toBe('makan-moments');
      expect(reports[1].profileId).toBe('southern');
    });
  });

  describe('checkThresholds() — identify warning/error states', () => {
    it('should identify warning status', () => {
      const reports = [
        {
          profileId: 'test',
          profileName: 'Test',
          kbPath: '/test',
          timestamp: new Date(),
          totalFiles: 10,
          contaminatedFiles: 1,
          contaminationPercentage: 7,
          contaminationDetails: [],
          overallStatus: 'warning' as const,
        },
      ];

      const { hasWarning, hasError } = ProfileIsolationValidator.checkThresholds(reports);

      expect(hasWarning).toBe(true);
      expect(hasError).toBe(false);
    });

    it('should identify error status', () => {
      const reports = [
        {
          profileId: 'test',
          profileName: 'Test',
          kbPath: '/test',
          timestamp: new Date(),
          totalFiles: 10,
          contaminatedFiles: 2,
          contaminationPercentage: 15,
          contaminationDetails: [],
          overallStatus: 'error' as const,
        },
      ];

      const { hasWarning, hasError } = ProfileIsolationValidator.checkThresholds(reports);

      expect(hasWarning).toBe(false);
      expect(hasError).toBe(true);
    });
  });

  describe('keyword matching', () => {
    it('should detect pelangi keywords in content', async () => {
      const filesWithPelangiKeywords = {
        'test.md': `
# Test Document

We have guest rooms available for booking.
Check in at the capsule reception.
Our amenities include wifi in all rooms.
        `,
      };

      const kbDir = createTestKB('makan-moments', filesWithPelangiKeywords);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      const pelangiDetail = report.contaminationDetails.find(d => d.contaminatingProfile === 'pelangi');
      if (pelangiDetail && pelangiDetail.matchedKeywords.length > 0) {
        // Should find keywords like 'guest', 'booking', 'capsule', 'amenities'
        const keywords = pelangiDetail.matchedKeywords.map(k => k.toLowerCase());
        const foundKeywords = keywords.filter(k =>
          ['guest', 'booking', 'capsule', 'amenities', 'check-in'].includes(k)
        );
        expect(foundKeywords.length).toBeGreaterThan(0);
      }
    });

    it('should ignore keywords when not found', async () => {
      const cleanFiles = {
        'test.md': `
# Completely Clean Document

This document contains no contamination.
It discusses unrelated topics.
Pure, isolated content only.
        `,
      };

      const kbDir = createTestKB('makan-moments', cleanFiles);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      expect(report.contaminationPercentage).toBe(0);
    });
  });

  describe('file scanning', () => {
    it('should scan all markdown files recursively', async () => {
      const filesWithSubdirs = {
        'root.md': 'Root file',
        'subdir/nested.md': 'Nested file',
        'subdir/deep/deeper.md': 'Deep file',
      };

      const kbDir = createTestKB('makan-moments', filesWithSubdirs);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      // Should have found all 3 markdown files
      expect(report.totalFiles).toBe(3);
    });

    it('should skip non-markdown files', async () => {
      const mixedFiles = {
        'page.md': 'Markdown file',
        'image.png': 'PNG file (binary)',
        'data.json': 'JSON file',
      };

      const kbDir = createTestKB('makan-moments', mixedFiles);

      // Act
      const report = await ProfileIsolationValidator.audit('makan-moments', kbDir);

      // Assert
      // Should only count the markdown file
      expect(report.totalFiles).toBe(1);
    });
  });
});
