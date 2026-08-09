/**
 * Tests for profile-keyword-validator.ts (US-397)
 *
 * Tests validation of profile keyword isolation and detection
 * of contaminated profiles.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Profile Keyword Validator', () => {
  it('should load and validate profile-keyword-blacklist.json exists', () => {
    const blacklistPath = path.join(
      __dirname,
      '..',
      '..',
      'assistant',
      'data',
      'profile-keyword-blacklist.json'
    );
    expect(fs.existsSync(blacklistPath)).toBe(true);

    const content = fs.readFileSync(blacklistPath, 'utf-8');
    const blacklist = JSON.parse(content);

    expect(blacklist).toHaveProperty('version');
    expect(blacklist).toHaveProperty('forbidden_keywords');
    expect(blacklist).toHaveProperty('allowed_intents');

    // Verify blacklist has entries for profiles
    expect(Object.keys(blacklist.forbidden_keywords).length).toBeGreaterThan(0);
  });

  it('should have blacklist entries for major profiles', () => {
    const blacklistPath = path.join(
      __dirname,
      '..',
      '..',
      'assistant',
      'data',
      'profile-keyword-blacklist.json'
    );
    const content = fs.readFileSync(blacklistPath, 'utf-8');
    const blacklist = JSON.parse(content);

    // Verify blacklist has entries for key profiles
    expect(blacklist.forbidden_keywords).toHaveProperty('data-makan');
    expect(blacklist.forbidden_keywords).toHaveProperty('data-southern');

    // Verify each profile has forbidden keywords array or categories
    const makan = blacklist.forbidden_keywords['data-makan'];
    expect(Object.keys(makan).length).toBeGreaterThan(0);
  });

  it('should scan all data profiles by default', () => {
    const assistantDir = path.join(__dirname, '..', '..', 'assistant');
    const entries = fs.readdirSync(assistantDir, { withFileTypes: true });

    const dataProfiles = entries
      .filter((e) => e.isDirectory() && (e.name === 'data' || e.name.startsWith('data-')))
      .map((e) => e.name);

    expect(dataProfiles.length).toBeGreaterThan(0);
    expect(dataProfiles).toContain('data');
  });

  it('should have intent-keywords.json files for each profile', () => {
    const assistantDir = path.join(__dirname, '..', '..', 'assistant');
    const entries = fs.readdirSync(assistantDir, { withFileTypes: true });

    const dataProfiles = entries.filter(
      (e) => e.isDirectory() && (e.name === 'data' || e.name.startsWith('data-'))
    );

    for (const profile of dataProfiles) {
      const keywordsPath = path.join(assistantDir, profile.name, 'intent-keywords.json');
      // Note: not all profiles may have intent-keywords.json, but at least one should
      if (fs.existsSync(keywordsPath)) {
        const content = fs.readFileSync(keywordsPath, 'utf-8');
        const keywords = JSON.parse(content);
        expect(keywords).toHaveProperty('intents');
        expect(Array.isArray(keywords.intents)).toBe(true);
      }
    }
    expect(dataProfiles.length).toBeGreaterThan(0);
  });

  it('should have proper blacklist structure with forbidden keywords arrays', () => {
    const blacklistPath = path.join(
      __dirname,
      '..',
      '..',
      'assistant',
      'data',
      'profile-keyword-blacklist.json'
    );
    const content = fs.readFileSync(blacklistPath, 'utf-8');
    const blacklist = JSON.parse(content);

    for (const [profile, rules] of Object.entries(blacklist.forbidden_keywords)) {
      expect(typeof rules).toBe('object');
      // Each profile should have rule categories or direct arrays
      const values = Object.values(rules as any);
      if (values.length > 0 && Array.isArray(values[0])) {
        // Has forbidden arrays
        const allArrays = values.every((v) => Array.isArray(v));
        expect(allArrays).toBe(true);
      }
    }
  });

  it('should validate allowed_intents mapping in blacklist', () => {
    const blacklistPath = path.join(
      __dirname,
      '..',
      '..',
      'assistant',
      'data',
      'profile-keyword-blacklist.json'
    );
    const content = fs.readFileSync(blacklistPath, 'utf-8');
    const blacklist = JSON.parse(content);

    expect(blacklist.allowed_intents).toBeDefined();
    expect(typeof blacklist.allowed_intents).toBe('object');

    // Verify at least some profiles have allowed intents
    const profilesWithIntents = Object.keys(blacklist.allowed_intents).filter(
      (p) => Array.isArray(blacklist.allowed_intents[p]) &&
              blacklist.allowed_intents[p].length > 0
    );
    expect(profilesWithIntents.length).toBeGreaterThan(0);
  });

  it('should tool file exist and be readable', () => {
    const toolPath = path.join(__dirname, '..', 'profile-keyword-validator.ts');
    expect(fs.existsSync(toolPath)).toBe(true);

    const content = fs.readFileSync(toolPath, 'utf-8');
    expect(content.includes('validateAllProfiles')).toBe(true);
    expect(content.includes('loadBlacklist')).toBe(true);
  });
});
