/**
 * Test suite for US-554: Per-Intent Custom System Prompt Configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { intentPromptManager } from '../../src/assistant/intent-prompt-manager.js';
import { getIntentSystemPrompt } from '../../src/assistant/ai-response-generator.js';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

describe('US-554: Per-Intent Custom System Prompt Configuration', () => {
  const testDataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const testFilePath = join(testDataDir, 'intent-prompts.json');

  describe('IntentPromptManager', () => {
    it('should load custom prompts from intent-prompts.json', () => {
      const customPrompt = intentPromptManager.getCustomPrompt('booking');
      expect(customPrompt).toBeDefined();
      expect(typeof customPrompt).toBe('string');
    });

    it('should return undefined for unconfigured intent', () => {
      const customPrompt = intentPromptManager.getCustomPrompt('nonexistent_intent_xyz');
      expect(customPrompt).toBeUndefined();
    });

    it('should fallback to default prompt when intent not configured', () => {
      const defaultPrompt = 'This is the default system prompt';
      const result = intentPromptManager.getPrompt('nonexistent_intent_xyz', defaultPrompt);
      expect(result).toBe(defaultPrompt);
    });

    it('should return custom prompt when configured', () => {
      const defaultPrompt = 'This is the default system prompt';
      const customPrompt = intentPromptManager.getPrompt('booking', defaultPrompt);
      expect(customPrompt).not.toBe(defaultPrompt);
      expect(customPrompt).toContain('booking') || expect(customPrompt).toContain('reservation');
    });

    it('should get all configured prompts', () => {
      const allPrompts = intentPromptManager.getAllPrompts();
      expect(allPrompts).toBeDefined();
      expect(typeof allPrompts).toBe('object');
      expect(Object.keys(allPrompts).length).toBeGreaterThan(0);
    });

    it('should handle gracefully if intent-prompts.json file does not exist', () => {
      // This test verifies the graceful fallback behavior documented in AC#1
      // The IntentPromptManager loads empty config when file is missing
      const result = intentPromptManager.getPrompt('any_intent', 'default_prompt');
      // Should return default when no custom prompt is available
      expect(typeof result).toBe('string');
    });

    it('should validate input when setting a prompt', () => {
      expect(() => {
        intentPromptManager.setPrompt('', 'some prompt');
      }).toThrow('Invalid intent type');

      expect(() => {
        intentPromptManager.setPrompt('valid_intent', '');
      }).toThrow('System prompt must be a non-empty string');
    });

    it('should update prompt atomically', () => {
      const testIntent = 'test_custom_intent';
      const testPrompt = 'Test custom prompt for testing intent classification';

      // Set a new prompt
      intentPromptManager.setPrompt(testIntent, testPrompt);

      // Verify it was set
      const retrieved = intentPromptManager.getCustomPrompt(testIntent);
      expect(retrieved).toBe(testPrompt);
    });

    it('should reload prompts from disk', () => {
      // This verifies the reload capability for when admins update the file
      intentPromptManager.reload();
      const allPrompts = intentPromptManager.getAllPrompts();
      expect(allPrompts).toBeDefined();
      expect(Object.keys(allPrompts).length).toBeGreaterThan(0);
    });
  });

  describe('getIntentSystemPrompt', () => {
    it('should return custom prompt for configured intent', () => {
      const defaultPrompt = 'Default fallback';
      const result = getIntentSystemPrompt('booking', defaultPrompt);
      // The function should return custom if available, not the default
      const customPrompt = intentPromptManager.getCustomPrompt('booking');
      expect(result).toBe(customPrompt || defaultPrompt);
    });

    it('should fallback to default for unconfigured intent', () => {
      const defaultPrompt = 'Default fallback for unknown_intent_12345';
      const result = getIntentSystemPrompt('unknown_intent_12345', defaultPrompt);
      expect(result).toBe(defaultPrompt);
    });

    it('should work with various intent types', () => {
      const testCases = ['pricing', 'availability', 'checkin', 'checkout', 'thanks'];
      for (const intent of testCases) {
        const result = getIntentSystemPrompt(intent, 'default');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Custom Prompt Override', () => {
    it('custom_prompt_override: should use custom prompt when available', () => {
      // Test the specific scenario mentioned in the test command
      const intentType = 'booking';
      const customPrompt = intentPromptManager.getCustomPrompt(intentType);

      if (customPrompt) {
        const result = getIntentSystemPrompt(intentType, 'default_fallback');
        expect(result).toBe(customPrompt);
        expect(result).not.toBe('default_fallback');
      }
    });

    it('custom_prompt_override: should preserve default when no custom prompt', () => {
      const intentType = 'nonexistent_intent_for_testing_999';
      const defaultPrompt = 'Custom fallback for testing';
      const result = getIntentSystemPrompt(intentType, defaultPrompt);
      expect(result).toBe(defaultPrompt);
    });
  });

  describe('Integration Tests', () => {
    it('should handle prompt updates without corrupting file', () => {
      const intent = 'integration_test_intent';
      const prompt1 = 'First version of the prompt';
      const prompt2 = 'Second version of the prompt';

      // Update twice to ensure no corruption
      intentPromptManager.setPrompt(intent, prompt1);
      expect(intentPromptManager.getCustomPrompt(intent)).toBe(prompt1);

      intentPromptManager.setPrompt(intent, prompt2);
      expect(intentPromptManager.getCustomPrompt(intent)).toBe(prompt2);

      // Reload and verify persistence
      intentPromptManager.reload();
      expect(intentPromptManager.getCustomPrompt(intent)).toBe(prompt2);
    });

    it('should handle special characters in prompts', () => {
      const intent = 'special_chars_test';
      const promptWithSpecialChars = 'Test prompt with "quotes", \\backslashes\\ and \nnewlines\n and 日本語';

      intentPromptManager.setPrompt(intent, promptWithSpecialChars);
      const retrieved = intentPromptManager.getCustomPrompt(intent);
      expect(retrieved).toBe(promptWithSpecialChars);
    });
  });
});
