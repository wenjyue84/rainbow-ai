/**
 * abandoned_workflow_reminders.integration.test.ts — Integration tests for US-562
 *
 * Tests booking workflow abandonment reminder functionality.
 *
 * Test Plan:
 * 1. Reminder builder: Generates correct messages in multiple languages
 * 2. Step label translation: Labels for all supported languages
 * 3. Message completeness: All required components present
 *
 * Run: npm run test tests/integration/abandoned_workflow_reminders.integration.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  buildReminderMessage,
  buildCompleteReminderNotification,
  getStepLabel,
  type ReminderContext,
} from '../../src/lib/reminder-builder.js';

describe('US-562: Booking Workflow Abandonment Recovery', () => {
  describe('Reminder Builder', () => {
    describe('getStepLabel()', () => {
      it('returns English step label for booking workflow', () => {
        const label = getStepLabel('booking', 'collect_guest_name', 'en');
        expect(label).toBe('Guest Name');
      });

      it('returns Malay step label', () => {
        const label = getStepLabel('booking', 'select_checkin_date', 'ms');
        expect(label).toBe('Tarikh Check-in');
      });

      it('returns Chinese step label', () => {
        const label = getStepLabel('booking', 'select_guest_count', 'zh');
        expect(label).toBe('客人人数');
      });

      it('returns Tamil step label', () => {
        const label = getStepLabel('booking', 'booking_confirmation', 'ta');
        expect(label).toBe('முன்பதிவு உறுதிப்படுத்தல்');
      });

      it('returns step ID if label not found', () => {
        const label = getStepLabel('booking', 'unknown_step', 'en');
        expect(label).toBe('unknown_step');
      });
    });

    describe('buildReminderMessage()', () => {
      it('builds English first reminder message', () => {
        const context: ReminderContext = {
          stepName: 'Guest Name',
          workflowId: 'booking',
          userLanguage: 'en',
          reminderNumber: 1,
          guestName: 'Ahmad',
        };

        const message = buildReminderMessage(context);

        expect(message.main).toContain('Ahmad');
        expect(message.main).toContain('You left off at');
        expect(message.main).toContain('Guest Name');
        expect(message.quickResume).toContain('Continue');
        expect(message.startFresh).toContain('Start fresh');
      });

      it('builds Malay first reminder message', () => {
        const context: ReminderContext = {
          stepName: 'Tarikh Check-in',
          workflowId: 'booking',
          userLanguage: 'ms',
          reminderNumber: 1,
          guestName: 'Siti',
        };

        const message = buildReminderMessage(context);

        expect(message.main).toContain('Siti');
        expect(message.main).toContain('berhenti');
      });

      it('builds English second reminder message with different tone', () => {
        const context: ReminderContext = {
          stepName: 'Guest Name',
          workflowId: 'booking',
          userLanguage: 'en',
          reminderNumber: 2,
          guestName: 'Ahmad',
        };

        const message = buildReminderMessage(context);

        expect(message.main).toContain('Still here');
        expect(message.main).toContain('minute');
      });

      it('builds complete reminder notification with all options', () => {
        const context: ReminderContext = {
          stepName: 'Guest Name',
          workflowId: 'booking',
          userLanguage: 'en',
          reminderNumber: 1,
        };

        const notification = buildCompleteReminderNotification(context);

        expect(notification).toContain('You left off');
        expect(notification).toContain('Guest Name');
        expect(notification).toContain('Continue');
        expect(notification).toContain('Start fresh');
      });
    });

    describe('Integration: Full Reminder Workflow', () => {
      it('generates correct reminder for abandoned English workflow', () => {
        const context: ReminderContext = {
          stepName: 'Guest Name',
          workflowId: 'booking',
          userLanguage: 'en',
          reminderNumber: 1,
          guestName: 'Ahmad',
        };

        const notification = buildCompleteReminderNotification(context);

        expect(notification).toContain('Ahmad');
        expect(notification).toContain('left off');
        expect(notification).toContain('Guest Name');
        expect(notification).toContain('Continue');
        expect(notification).toContain('Start fresh');
      });

      it('generates correct reminder for abandoned Malay workflow', () => {
        const context: ReminderContext = {
          stepName: 'Tarikh Check-in',
          workflowId: 'booking',
          userLanguage: 'ms',
          reminderNumber: 1,
          guestName: 'Siti',
        };

        const notification = buildCompleteReminderNotification(context);

        expect(notification).toContain('Siti');
        expect(notification).toContain('berhenti');
        expect(notification).toContain('lanjutkan');
      });
    });
  });
});
