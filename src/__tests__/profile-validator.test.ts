import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { validateProfileIsolation } from '../lib/profile-validator.js';

describe('Profile Validator', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test data
    tempDir = path.join(process.cwd(), '.test-profiles');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should pass validation for clean profile', async () => {
    // Create a clean profile structure
    const cleanProfileDir = path.join(tempDir, 'data-clean');
    fs.mkdirSync(cleanProfileDir, { recursive: true });

    // Create valid intents.json
    const intentsData = {
      categories: [
        {
          phase: 'CAFE_OPERATIONS',
          intents: [
            { category: 'menu_query', professional_term: 'Menu Inquiry' },
            { category: 'order_placement', professional_term: 'Order Placement' },
          ],
        },
      ],
    };
    fs.writeFileSync(
      path.join(cleanProfileDir, 'intents.json'),
      JSON.stringify(intentsData, null, 2)
    );

    // Create matching intent-keywords.json
    const keywordsData = {
      intents: [
        { intent: 'menu_query', keywords: { en: ['menu', 'show menu'] } },
        { intent: 'order_placement', keywords: { en: ['order', 'place order'] } },
      ],
    };
    fs.writeFileSync(
      path.join(cleanProfileDir, 'intent-keywords.json'),
      JSON.stringify(keywordsData, null, 2)
    );

    // Create knowledge.json with no Pelangi content
    const knowledgeData = {
      greeting: 'Welcome to our cafe!',
      faq: [{ question: 'What is the menu?', answer: 'We serve various items' }],
    };
    fs.writeFileSync(
      path.join(cleanProfileDir, 'knowledge.json'),
      JSON.stringify(knowledgeData, null, 2)
    );

    const result = await validateProfileIsolation(tempDir);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when keywords reference non-existent intents', async () => {
    // Create a profile with keyword references to non-existent intents
    const badProfileDir = path.join(tempDir, 'data-bad');
    fs.mkdirSync(badProfileDir, { recursive: true });

    // Create intents.json with limited intents
    const intentsData = {
      intents: [{ intent: 'greeting', keywords: { en: ['hi', 'hello'] } }],
    };
    fs.writeFileSync(
      path.join(badProfileDir, 'intents.json'),
      JSON.stringify(intentsData, null, 2)
    );

    // Create intent-keywords.json with reference to non-existent intent
    const keywordsData = {
      intents: [
        { intent: 'greeting', keywords: { en: ['hi'] } },
        { intent: 'non_existent_intent', keywords: { en: ['hello'] } }, // This intent doesn't exist
      ],
    };
    fs.writeFileSync(
      path.join(badProfileDir, 'intent-keywords.json'),
      JSON.stringify(keywordsData, null, 2)
    );

    const result = await validateProfileIsolation(tempDir);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain('non_existent_intent');
  });

  it('should detect Pelangi-specific content in Makan profile', async () => {
    // Create a Makan profile that contains Pelangi content
    const makanProfileDir = path.join(tempDir, 'data-makan');
    fs.mkdirSync(makanProfileDir, { recursive: true });

    // Create valid intents.json
    const intentsData = {
      intents: [{ intent: 'greeting', professional_term: 'Greeting' }],
    };
    fs.writeFileSync(
      path.join(makanProfileDir, 'intents.json'),
      JSON.stringify(intentsData, null, 2)
    );

    // Create intent-keywords.json
    const keywordsData = {
      intents: [{ intent: 'greeting', keywords: { en: ['hi'] } }],
    };
    fs.writeFileSync(
      path.join(makanProfileDir, 'intent-keywords.json'),
      JSON.stringify(keywordsData, null, 2)
    );

    // Create knowledge.json with Pelangi-specific content (should fail)
    const knowledgeData = {
      location: 'Pelangi Capsule Hostel at Jalan Desa, Petaling Jaya, Selangor',
      contact: 'Call us at our hostel in Kuala Lumpur',
      description: 'This is a hostel for backpackers',
    };
    fs.writeFileSync(
      path.join(makanProfileDir, 'knowledge.json'),
      JSON.stringify(knowledgeData, null, 2)
    );

    const result = await validateProfileIsolation(tempDir);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    
    // Check that at least one error mentions Pelangi content
    const hasContentError = result.errors.some((err) =>
      err.message.includes('Pelangi-specific content')
    );
    expect(hasContentError).toBe(true);
  });
});
