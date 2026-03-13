/**
 * US-408: SurveyFlow — Stub flow demonstrating the Flow interface.
 *
 * This is a minimal implementation showing how new flows can be
 * added by implementing the Flow interface and registering with
 * the flow registry — without modifying state-executor.ts.
 */
import type { Flow, FlowContext, FlowStepResult } from '../pipeline/types.js';

export interface SurveyState {
  surveyId: string;
  currentQuestionIndex: number;
  answers: Record<string, string>;
  completed: boolean;
}

export const surveyFlow: Flow = {
  type: 'survey',

  async start(context: FlowContext, _initialInput?: string | null): Promise<FlowStepResult> {
    const state: SurveyState = {
      surveyId: 'guest-satisfaction',
      currentQuestionIndex: 0,
      answers: {},
      completed: false,
    };

    const messages: Record<string, string> = {
      en: 'We\'d love your feedback! How would you rate your stay? (1-5)',
      ms: 'Kami ingin maklum balas anda! Bagaimana anda menilai penginapan? (1-5)',
      zh: '我们希望听到您的反馈！请为您的住宿评分 (1-5)',
    };

    return {
      response: messages[context.language] || messages.en,
      newState: state,
    };
  },

  async executeStep(state: SurveyState, userMessage: string, context: FlowContext): Promise<FlowStepResult> {
    // Store the answer for the current question
    state.answers[`q${state.currentQuestionIndex}`] = userMessage;
    state.currentQuestionIndex++;

    // Simple 2-question survey stub
    if (state.currentQuestionIndex === 1) {
      const messages: Record<string, string> = {
        en: 'Thank you! Any suggestions for improvement?',
        ms: 'Terima kasih! Ada cadangan untuk penambahbaikan?',
        zh: '谢谢！有什么改进建议吗？',
      };
      return {
        response: messages[context.language] || messages.en,
        newState: state,
      };
    }

    // Survey complete
    state.completed = true;
    const messages: Record<string, string> = {
      en: 'Thank you for your feedback! We appreciate it.',
      ms: 'Terima kasih atas maklum balas anda! Kami menghargainya.',
      zh: '感谢您的反馈！我们非常感谢。',
    };

    return {
      response: messages[context.language] || messages.en,
      newState: null,
    };
  },

  isComplete(state: SurveyState): boolean {
    return state.completed;
  },
};
