import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateKnowledgeBase, formatValidationReport } from '../../src/lib/validate-knowledge-base.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('validateKnowledgeBase - US-223', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), 'test-kb-' + Date.now());
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
  });

  it('should pass validation with all required fields', () => {
    const kb = {
      schema_version: '1.0',
      static: [
        {
          id: 'kb_001',
          intent: 'greeting',
          profile_id: 'pelangi',
          response: { en: 'Welcome!' }
        }
      ]
    };

    mkdirSync(join(tempDir, 'src', 'assistant', 'data'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'assistant', 'data', 'knowledge.json'), JSON.stringify(kb));

    const result = validateKnowledgeBase(tempDir);
    expect(result.isClean).toBe(true);
    expect(result.criticalViolations.length).toBe(0);
  });

  it('should report CRITICAL violation for missing profile_id', () => {
    const kb = {
      schema_version: '1.0',
      static: [{ id: 'kb_001', intent: 'greeting', response: { en: 'Hello!' } }]
    };

    mkdirSync(join(tempDir, 'src', 'assistant', 'data'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'assistant', 'data', 'knowledge.json'), JSON.stringify(kb));

    const result = validateKnowledgeBase(tempDir);
    expect(result.isClean).toBe(false);
    expect(result.criticalViolations.length).toBeGreaterThan(0);
    expect(result.criticalViolations[0]).toContain('profile_id');
  });

  it('should warn for missing id field (not critical)', () => {
    const kb = {
      schema_version: '1.0',
      static: [{ intent: 'greeting', profile_id: 'pelangi', response: { en: 'Hello!' } }]
    };

    mkdirSync(join(tempDir, 'src', 'assistant', 'data'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'assistant', 'data', 'knowledge.json'), JSON.stringify(kb));

    const result = validateKnowledgeBase(tempDir);
    expect(result.isClean).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('id');
  });

  it('should warn when makan profile has pelangi phrases', () => {
    const kb = {
      schema_version: '1.0',
      static: [
        {
          id: 'kb_001',
          intent: 'location',
          profile_id: 'makan',
          response: { en: 'Near the capsule hostel' }
        }
      ]
    };

    mkdirSync(join(tempDir, 'src', 'assistant', 'data-makan'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'assistant', 'data-makan', 'knowledge.json'), JSON.stringify(kb));

    const result = validateKnowledgeBase(tempDir);
    expect(result.warnings.some((w) => w.includes('contamination'))).toBe(true);
  });

  it('should report critical violation for malformed JSON', () => {
    mkdirSync(join(tempDir, 'src', 'assistant', 'data'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'assistant', 'data', 'knowledge.json'), 'bad json {');

    const result = validateKnowledgeBase(tempDir);
    expect(result.isClean).toBe(false);
    expect(result.criticalViolations[0]).toContain('parse JSON');
  });

  it('should format report with corrective actions', () => {
    const kb = {
      schema_version: '1.0',
      static: [{ intent: 'test', response: { en: 'test' } }]
    };

    mkdirSync(join(tempDir, 'src', 'assistant', 'data'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'assistant', 'data', 'knowledge.json'), JSON.stringify(kb));

    const result = validateKnowledgeBase(tempDir);
    expect(result.criticalViolations[0]).toContain('Corrective action');
    const report = formatValidationReport(result);
    expect(report).toContain('CRITICAL');
  });

  it('should validate multiple profiles', () => {
    const pelangiKb = { schema_version: '1.0', static: [{ id: 'kb_001', intent: 'test', profile_id: 'pelangi', response: { en: 'test' } }] };
    const makanKb = { schema_version: '1.0', static: [{ id: 'kb_002', intent: 'test', response: { en: 'missing profile_id' } }] };

    mkdirSync(join(tempDir, 'src', 'assistant', 'data'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'assistant', 'data-makan'), { recursive: true });
    
    writeFileSync(join(tempDir, 'src', 'assistant', 'data', 'knowledge.json'), JSON.stringify(pelangiKb));
    writeFileSync(join(tempDir, 'src', 'assistant', 'data-makan', 'knowledge.json'), JSON.stringify(makanKb));

    const result = validateKnowledgeBase(tempDir);
    expect(result.isClean).toBe(false);
    expect(result.criticalViolations.length).toBeGreaterThan(0);
  });
});
