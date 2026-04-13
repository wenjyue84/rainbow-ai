import { describe, it, expect, beforeAll } from 'vitest';
import { loadTemplateByLanguage, renderTemplate } from '../../src/assistant/response-processor.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Tamil Responses (US-568)', () => {
  let tamilData: any;

  beforeAll(() => {
    const tamilPath = path.join(__dirname, '../../src/assistant/data/tamil-responses.json');
    const content = fs.readFileSync(tamilPath, 'utf-8');
    tamilData = JSON.parse(content);
  });

  it('should have 50+ total templates across intents', () => {
    let templateCount = 0;
    for (const intent of Object.values(tamilData.intents) as any[]) {
      templateCount += Object.keys(intent).length;
    }
    expect(templateCount).toBeGreaterThanOrEqual(50);
  });

  it('should load Tamil templates from file', () => {
    const templates = loadTemplateByLanguage('tamil');
    expect(templates).not.toBeNull();
    expect(templates?.language).toBe('ta');
  });

  it('should render booking confirmation template', () => {
    const confirmTemplate = tamilData.intents.booking.confirmation;
    const rendered = renderTemplate(confirmTemplate, {
      guest_name: 'Raja',
      unit_number: '5A',
      check_in_date: '2025-04-15',
      check_out_date: '2025-04-18',
      total_price: '180'
    });

    expect(rendered).toContain('Raja');
    expect(rendered).toContain('5A');
    expect(rendered).toContain('2025-04-15');
  });

  it('should render booking inquiry template', () => {
    const inquiryTemplate = tamilData.intents.booking.inquiry;
    const rendered = renderTemplate(inquiryTemplate, {
      check_in_date: '2025-05-01',
      check_out_date: '2025-05-05'
    });

    expect(rendered).toContain('2025-05-01');
  });

  it('should render checkout confirmation with variables', () => {
    const checkoutTemplate = tamilData.intents.checkout.confirmation;
    const rendered = renderTemplate(checkoutTemplate, {
      guest_name: 'Priya',
      total_charged: '450',
      checkout_time: '12:00 PM'
    });

    expect(rendered).toContain('Priya');
  });

  it('should render availability check template', () => {
    const checkTemplate = tamilData.intents.availability.check;
    const rendered = renderTemplate(checkTemplate, {
      check_in_date: '2025-06-01',
      check_out_date: '2025-06-07'
    });

    expect(rendered).toContain('2025-06-01');
  });

  it('should render pricing template with group discount', () => {
    const groupTemplate = tamilData.intents.pricing.group;
    const rendered = renderTemplate(groupTemplate, {
      num_guests: '5',
      discount_percent: '15',
      total_savings: '450'
    });

    expect(rendered).toContain('5');
  });

  it('all templates should have required structure', () => {
    for (const [intentName, templates] of Object.entries(tamilData.intents)) {
      for (const [templateName, template] of Object.entries(templates as any)) {
        expect(template).toHaveProperty('text');
        expect(template).toHaveProperty('variables');
        expect(typeof template.text).toBe('string');
        expect(Array.isArray(template.variables)).toBe(true);
      }
    }
  });

  it('should verify schema version and language', () => {
    expect(tamilData.schema_version).toBeDefined();
    expect(tamilData.language).toBe('ta');
  });

  it('should have intents covering major categories', () => {
    const expectedIntents = ['booking', 'greeting', 'checkin', 'checkout', 'payment', 'escalation', 'fallback'];
    for (const intent of expectedIntents) {
      expect(tamilData.intents).toHaveProperty(intent);
    }
  });

  it('should render payment confirmation template', () => {
    const paymentTemplate = tamilData.intents.payment.confirmation;
    const rendered = renderTemplate(paymentTemplate, {
      receipt_number: 'RCP20250415001',
      amount: '540',
      payment_date: '2025-04-15',
      guest_name: 'Arjun'
    });

    expect(rendered).toContain('RCP20250415001');
  });
});
