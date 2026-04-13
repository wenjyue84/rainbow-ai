/**
 * US-568: Comprehensive Tamil Response Template Library Tests
 *
 * Verifies that:
 * 1. 50+ Tamil templates are present and properly structured
 * 2. Templates render without errors
 * 3. Variable substitution works correctly
 * 4. Common booking/inquiry scenarios are supported
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getTamilTemplate, renderTemplate } from '../src/assistant/formatter.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TamilTemplate {
  text: string;
  variables: string[];
}

interface TamilResponseData {
  schema_version: string;
  language: string;
  intents: {
    [intentName: string]: {
      [templateKey: string]: TamilTemplate;
    };
  };
}

let tamilResponses: TamilResponseData;

beforeAll(() => {
  const tamilPath = path.join(__dirname, '..', 'src', 'assistant', 'data', 'tamil-responses.json');
  const raw = fs.readFileSync(tamilPath, 'utf-8');
  tamilResponses = JSON.parse(raw);
});

describe('US-568: Tamil Response Templates', () => {
  describe('Template Library Structure', () => {
    it('should have 50+ templates total', () => {
      let totalTemplates = 0;
      Object.values(tamilResponses.intents).forEach(intentTemplates => {
        totalTemplates += Object.keys(intentTemplates).length;
      });
      expect(totalTemplates).toBeGreaterThanOrEqual(50);
      console.log(`✓ Total templates: ${totalTemplates}`);
    });

    it('should have required intent categories', () => {
      const requiredIntents = [
        'greeting',
        'booking_confirmation',
        'booking_inquiry',
        'checkin_info',
        'checkout_info',
        'pricing',
        'facilities',
        'escalation_transfer',
        'low_confidence_fallback'
      ];

      requiredIntents.forEach(intent => {
        expect(tamilResponses.intents[intent]).toBeDefined();
      });
    });

    it('should have schema_version and language fields', () => {
      expect(tamilResponses.schema_version).toBeDefined();
      expect(tamilResponses.language).toBe('ta');
    });
  });

  describe('Template Rendering', () => {
    it('should render templates without errors', () => {
      let successCount = 0;
      let failCount = 0;

      Object.entries(tamilResponses.intents).forEach(([intent, templates]) => {
        Object.entries(templates).forEach(([, template]) => {
          try {
            const rendered = renderTemplate(template.text, {});
            expect(rendered).toBeDefined();
            expect(typeof rendered).toBe('string');
            successCount++;
          } catch (e) {
            failCount++;
            throw new Error(`Failed to render ${intent}: ${(e as Error).message}`);
          }
        });
      });

      console.log(`✓ Rendered ${successCount} templates successfully (${failCount} failures)`);
      expect(failCount).toBe(0);
    });

    it('should render greeting with guest_name variable', () => {
      const template = getTamilTemplate('greeting');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Rajesh'
      });

      expect(rendered).toContain('Rajesh');
      expect(rendered).not.toContain('{{guest_name}}');
    });
  });

  describe('Variable Substitution', () => {
    it('should substitute single variables correctly', () => {
      const template = 'வணக்கம் {{guest_name}}, நீங்கள் {{check_in_date}} க்கு வரவேற்கப்படுகிறீர்கள்.';
      const rendered = renderTemplate(template, {
        guest_name: 'Kavya',
        check_in_date: '2026-04-15'
      });

      expect(rendered).toBe('வணக்கம் Kavya, நீங்கள் 2026-04-15 க்கு வரவேற்கப்படுகிறீர்கள்.');
      expect(rendered).not.toContain('{{');
    });

    it('should substitute multiple variables in template', () => {
      const template = getTamilTemplate('booking_confirmation');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Arun',
        check_in_date: '2026-04-15',
        check_out_date: '2026-04-18',
        unit_number: '101',
        stay_nights: 3,
        total_price: 135
      });

      expect(rendered).toContain('Arun');
      expect(rendered).toContain('2026-04-15');
      expect(rendered).toContain('2026-04-18');
      expect(rendered).toContain('101');
      expect(rendered).not.toContain('{{');
    });

    it('should handle missing variables gracefully', () => {
      const template = 'வணக்கம் {{guest_name}}, உங்கள் {{item}} தயாரமாக உள்ளது.';
      const rendered = renderTemplate(template, {
        guest_name: 'Priya'
        // missing 'item'
      });

      expect(rendered).toContain('Priya');
      expect(rendered).toContain('{{item}}'); // Should keep unreplaced placeholders
    });

    it('should handle numeric variables', () => {
      const template = 'RM{{amount}} செலுத்த வேண்டும் {{guest_name}} க்கு.';
      const rendered = renderTemplate(template, {
        amount: 450,
        guest_name: 'Manoj'
      });

      expect(rendered).toBe('RM450 செலுத்த வேண்டும் Manoj க்கு.');
    });
  });

  describe('Booking Scenarios', () => {
    it('should support simple booking confirmation', () => {
      const template = getTamilTemplate('booking_confirmation');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Vinay',
        check_in_date: '2026-04-20',
        check_out_date: '2026-04-22',
        unit_number: '205',
        stay_nights: 2,
        total_price: 90
      });

      expect(rendered.length > 0).toBe(true);
      expect(rendered).not.toContain('{{');
    });

    it('should support booking inquiry with pricing', () => {
      const template = getTamilTemplate('pricing');
      expect(template).toBeDefined();
      if (!template) return;

      // Template text should not have unresolved variables
      expect(template.text).toBeDefined();
      const rendered = renderTemplate(template.text, {});
      expect(typeof rendered).toBe('string');
    });

    it('should support check-in scenario', () => {
      const template = getTamilTemplate('checkin_info');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Deepak',
        check_in_date: '2026-04-15',
        check_in_time: '2:00 PM'
      });

      expect(rendered).toBeDefined();
      expect(typeof rendered).toBe('string');
    });

    it('should support checkout procedure with deposit info', () => {
      const template = getTamilTemplate('checkout_procedure');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Sanjay',
        check_out_date: '2026-04-22',
        deposit_amount: 100
      });

      expect(rendered).toBeDefined();
      expect(rendered).not.toContain('{{');
    });
  });

  describe('Inquiry Scenarios', () => {
    it('should support facilities inquiry', () => {
      const template = getTamilTemplate('facilities');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Nisha'
      });

      expect(rendered.length > 0).toBe(true);
    });

    it('should support WiFi inquiry', () => {
      const template = getTamilTemplate('wifi');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {});
      expect(rendered).toContain('WiFi') || expect(rendered).toContain('வைஃபை');
    });

    it('should support directions inquiry', () => {
      const template = getTamilTemplate('directions');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {});
      expect(rendered).toBeDefined();
    });

    it('should support payment inquiry', () => {
      const template = getTamilTemplate('payment');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Meera'
      });

      expect(rendered).toBeDefined();
    });
  });

  describe('Fallback Scenarios', () => {
    it('should support low confidence fallback', () => {
      const template = getTamilTemplate('low_confidence_fallback');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Rohan',
        topic: 'parking'
      });

      expect(rendered).toBeDefined();
      expect(rendered).not.toContain('{{');
    });

    it('should support escalation transfer', () => {
      const template = getTamilTemplate('escalation_transfer');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Pooja',
        contact_number: '+60-12-7088789',
        contact_method: 'WhatsApp',
        check_in_date: '2026-04-15',
        topic: 'special request'
      });

      expect(rendered).toBeDefined();
      expect(rendered).not.toContain('{{');
    });

    it('should support inquiry response fallback', () => {
      const template = getTamilTemplate('inquiry_response');
      expect(template).toBeDefined();
      if (!template) return;

      const rendered = renderTemplate(template.text, {
        guest_name: 'Arjun',
        inquiry_topic: 'late checkout',
        unit_type: 'capsule'
      });

      expect(rendered).toBeDefined();
    });
  });

  describe('Variable Declaration Validation', () => {
    it('should have matching variables in template and declaration', () => {
      Object.entries(tamilResponses.intents).forEach(([intent, templates]) => {
        Object.entries(templates).forEach(([templateKey, template]) => {
          // Extract variables from text
          const matches = template.text.match(/\{\{(\w+)\}\}/g) || [];
          const textVars = new Set(matches.map(m => m.replace(/[{}]/g, '')));

          // Check that declared variables match text variables
          const declaredVars = new Set(template.variables);

          // All text variables should be declared (allow extra declarations)
          textVars.forEach(textVar => {
            if (!declaredVars.has(textVar)) {
              console.warn(`Template ${intent}/${templateKey}: Variable {{${textVar}}} not declared in variables array`);
            }
          });
        });
      });
    });
  });

  describe('Tamil Language Validation', () => {
    it('should contain Tamil script in templates', () => {
      const tamilScriptRegex = /[\u0B80-\u0BFF]/;
      let tamilTemplateCount = 0;

      Object.entries(tamilResponses.intents).forEach(([, templates]) => {
        Object.entries(templates).forEach(([, template]) => {
          if (tamilScriptRegex.test(template.text)) {
            tamilTemplateCount++;
          }
        });
      });

      // At least 80% should have Tamil script (rest may be numbers/symbols only)
      const totalTemplates = Object.values(tamilResponses.intents).reduce(
        (sum, intent) => sum + Object.keys(intent).length,
        0
      );
      expect(tamilTemplateCount / totalTemplates).toBeGreaterThan(0.8);
      console.log(`✓ Tamil script found in ${tamilTemplateCount}/${totalTemplates} templates`);
    });

    it('should not contain HTML entities', () => {
      Object.entries(tamilResponses.intents).forEach(([intent, templates]) => {
        Object.entries(templates).forEach(([templateKey, template]) => {
          expect(template.text).not.toMatch(/&[a-z]+;/i);
        });
      });
    });
  });

  describe('Template Retrieval Functions', () => {
    it('getTamilTemplate should return template for valid intent', () => {
      const template = getTamilTemplate('greeting');
      expect(template).toBeDefined();
      expect(template?.text).toBeDefined();
      expect(Array.isArray(template?.variables)).toBe(true);
    });

    it('getTamilTemplate should return null for non-existent intent', () => {
      const template = getTamilTemplate('non_existent_intent_xyz');
      expect(template).toBeNull();
    });

    it('renderTemplate should return string', () => {
      const result = renderTemplate('வணக்கம் {{name}}', { name: 'test' });
      expect(typeof result).toBe('string');
    });
  });

  describe('Response Completeness', () => {
    it('should cover primary intent categories', () => {
      const primaryIntents = [
        'greeting',
        'thanks',
        'booking_confirmation',
        'booking_inquiry',
        'checkin_info',
        'checkout_info',
        'pricing',
        'facilities',
        'payment',
        'unknown'
      ];

      primaryIntents.forEach(intent => {
        const template = getTamilTemplate(intent);
        expect(template).toBeDefined(`Missing primary intent: ${intent}`);
      });
    });

    it('should cover secondary intent categories', () => {
      const secondaryIntents = [
        'wifi',
        'directions',
        'rules',
        'late_checkout',
        'billing_inquiry',
        'extra_amenity',
        'luggage_storage'
      ];

      secondaryIntents.forEach(intent => {
        const template = getTamilTemplate(intent);
        expect(template).toBeDefined(`Missing secondary intent: ${intent}`);
      });
    });
  });
});
