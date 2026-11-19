/**
 * Transfer Documents Types
 * Questionnaire responses recorded on a transfer request
 */

/**
 * Response to a single question
 */
export interface QuestionResponse {
  questionId: string;
  value: string | boolean | string[] | number | null;
}

/**
 * Complete questionnaire responses
 */
export interface QuestionnaireResponse {
  responses: QuestionResponse[];
  completedAt: string;
  completedBy: string;
  attendingPhysician?: string;
  diagnosis?: string;
}
