/**
 * reminder-builder.ts — Builds workflow abandonment reminder messages
 *
 * Constructs contextual reminder messages for abandoned booking workflows,
 * including the step name, quick-resume link, and option to start fresh.
 * Messages are localized to the user's detected language.
 *
 * US-562: Smart reminder messages in user's language with checkpoint info
 */

import type { ConversationState } from '../assistant/types.js';

export interface ReminderContext {
  stepName: string;           // Human-readable step name (e.g., "Guest Information")
  workflowId: string;         // Workflow type (e.g., "booking")
  userLanguage: 'en' | 'ms' | 'zh' | 'ta';
  reminderNumber: number;     // 1 for first reminder, 2 for second, etc.
  guestName?: string;         // Optional: personalize greeting
}

interface ReminderMessage {
  main: string;               // Primary reminder message
  quickResume: string;        // Quick-resume option
  startFresh: string;         // Start over option
}

/**
 * Map workflow step IDs to human-readable step names
 * Used to tell users where they left off
 */
export const STEP_NAME_LABELS: Record<string, Record<string, string>> = {
  booking: {
    en: {
      collect_guest_name: "Guest Name",
      collect_guest_email: "Email Address",
      collect_guest_phone: "Phone Number",
      select_checkin_date: "Check-in Date",
      select_checkout_date: "Check-out Date",
      select_guest_count: "Number of Guests",
      booking_confirmation: "Booking Confirmation",
    },
    ms: {
      collect_guest_name: "Nama Tetamu",
      collect_guest_email: "Alamat E-mel",
      collect_guest_phone: "Nombor Telefon",
      select_checkin_date: "Tarikh Check-in",
      select_checkout_date: "Tarikh Check-out",
      select_guest_count: "Bilangan Tetamu",
      booking_confirmation: "Pengesahan Tempahan",
    },
    zh: {
      collect_guest_name: "客人姓名",
      collect_guest_email: "电子邮件地址",
      collect_guest_phone: "电话号码",
      select_checkin_date: "入住日期",
      select_checkout_date: "退房日期",
      select_guest_count: "客人人数",
      booking_confirmation: "预订确认",
    },
    ta: {
      collect_guest_name: "விருந்தினர் பெயர்",
      collect_guest_email: "மின்னஞ்சல் முகவரி",
      collect_guest_phone: "தொலைபேசி எண்",
      select_checkin_date: "செக்-இன் தேதி",
      select_checkout_date: "செக்-அவுட் தேதி",
      select_guest_count: "விருந்தினர்களின் எண்ணிக்கை",
      booking_confirmation: "முன்பதிவு உறுதிப்படுத்தல்",
    },
  },
};

/**
 * Get human-readable label for a workflow step
 */
export function getStepLabel(
  workflowId: string,
  stepId: string,
  language: 'en' | 'ms' | 'zh' | 'ta' = 'en',
): string {
  const stepLabels = STEP_NAME_LABELS[workflowId]?.[language] || {};
  return stepLabels[stepId] || stepId;
}

/**
 * Build a reminder message for an abandoned workflow
 *
 * First reminder (reminderNumber=1): "You left off at [step]"
 * Second reminder (reminderNumber=2): "Still here? Complete your booking"
 *
 * Each message includes a quick-resume option and start-fresh option
 */
export function buildReminderMessage(context: ReminderContext): ReminderMessage {
  const {
    stepName,
    workflowId,
    userLanguage,
    reminderNumber,
    guestName,
  } = context;

  const greeting = guestName ? `Hi ${guestName}` : "Hi there";

  const messages: Record<'en' | 'ms' | 'zh' | 'ta', ReminderMessage> = {
    en: buildEnglishReminder(greeting, stepName, reminderNumber),
    ms: buildMalayReminder(greeting, stepName, reminderNumber),
    zh: buildChineseReminder(greeting, stepName, reminderNumber),
    ta: buildTamilReminder(greeting, stepName, reminderNumber),
  };

  return messages[userLanguage] || messages.en;
}

// ─── English Messages ────────────────────────────────────────────────────

function buildEnglishReminder(
  greeting: string,
  stepName: string,
  reminderNumber: number,
): ReminderMessage {
  if (reminderNumber === 1) {
    return {
      main: `${greeting}! 👋 You left off at the "${stepName}" step. Your booking is almost complete!\n\nWould you like to continue from where you left off, or start fresh?`,
      quickResume: "✅ Continue from checkpoint",
      startFresh: "🔄 Start fresh",
    };
  }
  // Second+ reminder
  return {
    main: `${greeting}! 📋 Still here? We'd love to complete your booking together. You were at the "${stepName}" step.\n\nLet's finish this booking! (It only takes a minute.)`,
    quickResume: "✅ Continue from checkpoint",
    startFresh: "🔄 Start fresh",
  };
}

// ─── Malay Messages ─────────────────────────────────────────────────────

function buildMalayReminder(
  greeting: string,
  stepName: string,
  reminderNumber: number,
): ReminderMessage {
  if (reminderNumber === 1) {
    return {
      main: `${greeting}! 👋 Anda berhenti di langkah "${stepName}". Tempahan anda hampir selesai!\n\nAdakah anda ingin melanjutkan dari tempat anda berhenti, atau mulai semula?`,
      quickResume: "✅ Lanjutkan dari titik semak",
      startFresh: "🔄 Mulai semula",
    };
  }
  return {
    main: `${greeting}! 📋 Masih di sini? Kami ingin menyelesaikan tempahan anda bersama-sama. Anda berada di langkah "${stepName}".\n\nAyuh selesaikan tempahan ini! (Ia hanya mengambil masa satu minit.)`,
    quickResume: "✅ Lanjutkan dari titik semak",
    startFresh: "🔄 Mulai semula",
  };
}

// ─── Chinese (Simplified) Messages ──────────────────────────────────────

function buildChineseReminder(
  greeting: string,
  stepName: string,
  reminderNumber: number,
): ReminderMessage {
  if (reminderNumber === 1) {
    return {
      main: `${greeting}! 👋 您已停留在"${stepName}"步骤。您的预订即将完成！\n\n您想从停止的地方继续，还是重新开始？`,
      quickResume: "✅ 从检查点继续",
      startFresh: "🔄 重新开始",
    };
  }
  return {
    main: `${greeting}! 📋 还在这里吗？我们想和您一起完成预订。您正在"${stepName}"步骤。\n\n让我们完成这个预订吧！（只需要一分钟。）`,
    quickResume: "✅ 从检查点继续",
    startFresh: "🔄 重新开始",
  };
}

// ─── Tamil Messages ─────────────────────────────────────────────────────

function buildTamilReminder(
  greeting: string,
  stepName: string,
  reminderNumber: number,
): ReminderMessage {
  if (reminderNumber === 1) {
    return {
      main: `${greeting}! 👋 நீங்கள் "${stepName}" படியில் விட்டுச் சென்றுவிட்டீர்கள். உங்கள் முன்பதிவு கிட்டத்தட்ட முடிந்துவிட்டது!\n\nநீங்கள் நிறுத்திய இடத்திலிருந்து தொடர விரும்புகிறீர்களா, அல்லது புதிதாக தொடங்க விரும்புகிறீர்களா?`,
      quickResume: "✅ சரிபார்ப்புப் புள்ளியிலிருந்து தொடரவும்",
      startFresh: "🔄 புதிதாக தொடங்குங்கள்",
    };
  }
  return {
    main: `${greeting}! 📋 இன்னும் இருக்கிறீர்களா? உங்கள் முன்பதிவை நாங்கள் முடிக்க விரும்புகிறோம். நீங்கள் "${stepName}" படியில் இருந்தீர்கள்.\n\nஇந்த முன்பதிவை முடிப்போம்! (இது ஒரு நிமிடம் மட்டுமே ஆகும்.)`,
    quickResume: "✅ சரிபார்ப்புப் புள்ளியிலிருந்து தொடரவும்",
    startFresh: "🔄 புதிதாக தொடங்குங்கள்",
  };
}

/**
 * Builds a complete reminder notification combining main message + options
 */
export function buildCompleteReminderNotification(context: ReminderContext): string {
  const reminder = buildReminderMessage(context);

  return `${reminder.main}\n\n${reminder.quickResume}\n${reminder.startFresh}`;
}
