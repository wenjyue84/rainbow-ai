/**
 * US-871: Check-in Form Flow
 *
 * Text-based structured check-in form for hostel guests.
 * Collects: full name, IC/passport number, arrival time, bed preference, emergency contact.
 *
 * This is the Baileys fallback for WhatsApp Flows (which require Cloud API).
 * The form is only available for the Pelangi profile (hostel use-case).
 */
import type { Flow, FlowContext, FlowStepResult } from '../pipeline/types.js';

export type CheckinFormStep =
  | 'full_name'
  | 'ic_passport'
  | 'arrival_time'
  | 'bed_preference'
  | 'emergency_contact'
  | 'confirm'
  | 'done';

export interface CheckinFormState {
  step: CheckinFormStep;
  fullName?: string;
  icPassport?: string;
  arrivalTime?: string;
  bedPreference?: string;
  emergencyContact?: string;
}

const CANCEL_KEYWORDS = ['cancel', 'batal', 'nevermind', 'never mind', 'stop', 'quit', 'exit'];

function isCancelMessage(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return CANCEL_KEYWORDS.some(kw => lower === kw || lower.startsWith(kw + ' '));
}

type Lang = 'en' | 'ms' | 'zh' | 'ta';

function msg(messages: Record<string, string>, lang: Lang): string {
  return messages[lang] || messages.en;
}

const PROMPTS: Record<string, Record<string, string>> = {
  welcome: {
    en: "Welcome! Let's complete your check-in form. I'll ask you a few questions.\n\nYou can type *cancel* at any time to stop.\n\nWhat is your *full name* (as on your passport or IC)?",
    ms: "Selamat datang! Mari lengkapkan borang check-in anda. Saya akan tanya beberapa soalan.\n\nAnda boleh taip *batal* pada bila-bila masa untuk berhenti.\n\nApakah *nama penuh* anda (seperti dalam pasport atau IC)?",
    zh: "欢迎！让我们完成您的入住登记表。我会问您几个问题。\n\n您可以随时输入 *cancel* 取消。\n\n请问您的*全名*是什么（护照或身份证上的）？",
  },
  ic_passport: {
    en: "Thank you, {{name}}! What is your *IC or passport number*?",
    ms: "Terima kasih, {{name}}! Apakah *nombor IC atau pasport* anda?",
    zh: "谢谢，{{name}}！请提供您的*身份证或护照号码*。",
  },
  arrival_time: {
    en: "Got it! What is your *expected arrival time*? (e.g., 3 PM, 15:00)",
    ms: "Baik! Bilakah *jangkaan masa ketibaan* anda? (contoh: 3 PM, 15:00)",
    zh: "好的！您的*预计到达时间*是？（例如：下午3点，15:00）",
  },
  bed_preference: {
    en: "Do you have a *bed preference*?\n\n1. Upper deck\n2. Lower deck\n3. No preference\n\n(Reply with a number or type your preference)",
    ms: "Adakah anda ada *pilihan katil*?\n\n1. Atas (upper deck)\n2. Bawah (lower deck)\n3. Tiada pilihan\n\n(Balas dengan nombor atau taip pilihan anda)",
    zh: "您有*床位偏好*吗？\n\n1. 上铺\n2. 下铺\n3. 无偏好\n\n（回复数字或输入您的偏好）",
  },
  emergency_contact: {
    en: "Almost done! Please provide an *emergency contact* (name and phone number).",
    ms: "Hampir siap! Sila berikan *nombor kecemasan* (nama dan nombor telefon).",
    zh: "快完成了！请提供一个*紧急联系人*（姓名和电话号码）。",
  },
  cancelled: {
    en: "Check-in form cancelled. You can start again anytime by saying 'check in'.",
    ms: "Borang check-in dibatalkan. Anda boleh mula semula bila-bila dengan cakap 'check in'.",
    zh: '入住登记已取消。您可以随时说 check in 重新开始。',
  },
};

function normalizeBedPreference(input: string): string {
  const lower = input.toLowerCase().trim();
  if (lower === '1' || lower.includes('upper') || lower.includes('atas')) return 'Upper deck';
  if (lower === '2' || lower.includes('lower') || lower.includes('bawah')) return 'Lower deck';
  if (lower === '3' || lower.includes('no pref') || lower.includes('tiada') || lower.includes('any')) return 'No preference';
  return input.trim(); // Keep as-is if not a standard choice
}

function buildSummary(state: CheckinFormState, lang: Lang): string {
  const summaries: Record<string, string> = {
    en: `*Check-in Form Summary*\n\nName: *${state.fullName}*\nIC/Passport: *${state.icPassport}*\nArrival Time: *${state.arrivalTime}*\nBed Preference: *${state.bedPreference}*\nEmergency Contact: *${state.emergencyContact}*\n\nIs this correct? Reply *yes* to confirm or *no* to start over.`,
    ms: `*Ringkasan Borang Check-in*\n\nNama: *${state.fullName}*\nIC/Pasport: *${state.icPassport}*\nMasa Ketibaan: *${state.arrivalTime}*\nPilihan Katil: *${state.bedPreference}*\nKontak Kecemasan: *${state.emergencyContact}*\n\nAdakah ini betul? Balas *ya* untuk sahkan atau *tidak* untuk mula semula.`,
    zh: `*入住登记摘要*\n\n姓名：*${state.fullName}*\n证件号码：*${state.icPassport}*\n到达时间：*${state.arrivalTime}*\n床位偏好：*${state.bedPreference}*\n紧急联系人：*${state.emergencyContact}*\n\n信息正确吗？回复 *yes* 确认或 *no* 重新填写。`,
  };
  return msg(summaries, lang);
}

function buildConfirmation(state: CheckinFormState, lang: Lang): string {
  const confirmations: Record<string, string> = {
    en: `Your check-in form has been submitted successfully!\n\nWe've notified our staff about your arrival. Here's some useful info:\n\n*Check-in time:* 2:00 PM\n*Door password:* 1270#\n*WiFi:* PelangiHostel\n\nSee you soon, ${state.fullName}!`,
    ms: `Borang check-in anda telah berjaya dihantar!\n\nKami telah maklumkan staf tentang ketibaan anda. Ini maklumat berguna:\n\n*Masa check-in:* 2:00 PM\n*Password pintu:* 1270#\n*WiFi:* PelangiHostel\n\nJumpa nanti, ${state.fullName}!`,
    zh: `您的入住登记表已成功提交！\n\n我们已通知工作人员您的到来。以下是一些有用信息：\n\n*入住时间：* 下午2:00\n*门密码：* 1270#\n*WiFi：* PelangiHostel\n\n期待见到您，${state.fullName}！`,
  };
  return msg(confirmations, lang);
}

function buildAdminNotification(state: CheckinFormState, phone: string, pushName: string): string {
  return [
    `*New Check-in Form Submitted*`,
    ``,
    `Guest: ${state.fullName} (${pushName})`,
    `Phone: ${phone}`,
    `IC/Passport: ${state.icPassport}`,
    `Arrival Time: ${state.arrivalTime}`,
    `Bed Preference: ${state.bedPreference}`,
    `Emergency Contact: ${state.emergencyContact}`,
  ].join('\n');
}

const YES_KEYWORDS = ['yes', 'ya', 'ok', 'okay', 'confirm', 'sahkan', 'betul', 'correct', 'yep', 'yup', 'y', 'sure'];
const NO_KEYWORDS = ['no', 'tidak', 'wrong', 'salah', 'nope', 'n', 'restart', 'start over'];

function isYes(text: string): boolean {
  return YES_KEYWORDS.includes(text.toLowerCase().trim());
}
function isNo(text: string): boolean {
  return NO_KEYWORDS.includes(text.toLowerCase().trim());
}

export const checkinFormFlow: Flow = {
  type: 'checkin_form',

  async start(context: FlowContext, _initialInput?: string | null): Promise<FlowStepResult> {
    const state: CheckinFormState = { step: 'full_name' };
    return {
      response: msg(PROMPTS.welcome, context.language),
      newState: state,
    };
  },

  async executeStep(state: CheckinFormState, userMessage: string, context: FlowContext): Promise<FlowStepResult> {
    const lang = context.language;
    const text = userMessage.trim();

    // Cancel at any step
    if (isCancelMessage(text)) {
      return { response: msg(PROMPTS.cancelled, lang), newState: null };
    }

    switch (state.step) {
      case 'full_name': {
        if (text.length < 2) {
          return {
            response: msg({
              en: 'Please enter your full name (at least 2 characters).',
              ms: 'Sila masukkan nama penuh anda (sekurang-kurangnya 2 aksara).',
              zh: '请输入您的全名（至少2个字符）。',
            }, lang),
            newState: state,
          };
        }
        state.fullName = text;
        state.step = 'ic_passport';
        const prompt = msg(PROMPTS.ic_passport, lang).replace('{{name}}', state.fullName);
        return { response: prompt, newState: state };
      }

      case 'ic_passport': {
        if (text.length < 4) {
          return {
            response: msg({
              en: 'Please enter a valid IC or passport number.',
              ms: 'Sila masukkan nombor IC atau pasport yang sah.',
              zh: '请输入有效的身份证或护照号码。',
            }, lang),
            newState: state,
          };
        }
        state.icPassport = text;
        state.step = 'arrival_time';
        return { response: msg(PROMPTS.arrival_time, lang), newState: state };
      }

      case 'arrival_time': {
        state.arrivalTime = text;
        state.step = 'bed_preference';
        return { response: msg(PROMPTS.bed_preference, lang), newState: state };
      }

      case 'bed_preference': {
        state.bedPreference = normalizeBedPreference(text);
        state.step = 'emergency_contact';
        return { response: msg(PROMPTS.emergency_contact, lang), newState: state };
      }

      case 'emergency_contact': {
        if (text.length < 3) {
          return {
            response: msg({
              en: 'Please provide an emergency contact (name and phone number).',
              ms: 'Sila berikan kontak kecemasan (nama dan nombor telefon).',
              zh: '请提供紧急联系人（姓名和电话号码）。',
            }, lang),
            newState: state,
          };
        }
        state.emergencyContact = text;
        state.step = 'confirm';
        return { response: buildSummary(state, lang), newState: state };
      }

      case 'confirm': {
        if (isYes(text)) {
          state.step = 'done';

          // Notify admin via WhatsApp
          try {
            const settings = context.profileConfig.getSettings();
            const adminPhone = settings.admin_phone || settings.escalation?.primary_phone;
            if (adminPhone && context.sendMessage) {
              const notification = buildAdminNotification(state, context.phone, context.pushName);
              await context.sendMessage(adminPhone, notification, context.instanceId);
              console.log(`[CheckinForm] Admin notified at ${adminPhone} for ${context.phone}`);
            }
          } catch (err: any) {
            console.error(`[CheckinForm] Failed to notify admin:`, err.message);
          }

          return {
            response: buildConfirmation(state, lang),
            newState: null, // Flow complete
            metadata: {
              checkinForm: {
                fullName: state.fullName,
                icPassport: state.icPassport,
                arrivalTime: state.arrivalTime,
                bedPreference: state.bedPreference,
                emergencyContact: state.emergencyContact,
                submittedAt: new Date().toISOString(),
              },
            },
          };
        }

        if (isNo(text)) {
          // Restart the form
          const freshState: CheckinFormState = { step: 'full_name' };
          return {
            response: msg({
              en: "No problem! Let's start over.\n\nWhat is your *full name* (as on your passport or IC)?",
              ms: "Tiada masalah! Mari mula semula.\n\nApakah *nama penuh* anda (seperti dalam pasport atau IC)?",
              zh: "没问题！让我们重新开始。\n\n请问您的*全名*是什么（护照或身份证上的）？",
            }, lang),
            newState: freshState,
          };
        }

        // Unrecognized response at confirmation
        return {
          response: msg({
            en: 'Please reply *yes* to confirm or *no* to start over.',
            ms: 'Sila balas *ya* untuk sahkan atau *tidak* untuk mula semula.',
            zh: '请回复 *yes* 确认或 *no* 重新填写。',
          }, lang),
          newState: state,
        };
      }

      default:
        return { response: msg(PROMPTS.cancelled, lang), newState: null };
    }
  },

  isComplete(state: CheckinFormState): boolean {
    return state.step === 'done';
  },
};
