/**
 * Transfer Documents Types
 * Types for hospital-specific document generation during patient transfers
 */

// ============================================================================
// Question Types
// ============================================================================

/**
 * Type of input for a transfer question
 */
export type QuestionType =
    | 'text'           // Free text input
    | 'textarea'       // Multi-line text
    | 'select'         // Single selection from options
    | 'multiselect'    // Multiple selections
    | 'boolean'        // Yes/No toggle
    | 'date'           // Date picker
    | 'time'           // Time picker
    | 'phone'          // Phone number input
    | 'number';        // Numeric input

/**
 * A single question in the transfer questionnaire
 */
export interface TransferQuestion {
    /** Unique identifier for the question */
    id: string;

    /** Display label for the question */
    label: string;

    /** Type of input control */
    type: QuestionType;

    /** Whether this question is required */
    required: boolean;

    /** Available options for select/multiselect types */
    options?: string[];

    /** Default value if any */
    defaultValue?: string | boolean | string[];

    /** Placeholder text for inputs */
    placeholder?: string;

    /** Help text shown below the input */
    helpText?: string;

    /** Group/category for organizing questions */
    group?: string;

    /** Conditional display: only show if another question has specific value */
    showIf?: {
        questionId: string;
        value: string | boolean;
    };
}

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

// ============================================================================
// Hospital Configuration Types
// ============================================================================

/**
 * Template document definition
 */
export interface DocumentTemplate {
    /** Unique identifier */
    id: string;

    /** Display name */
    name: string;

    /** Original file path (for reference) */
    originalPath?: string;

    /** Output format */
    format: 'docx' | 'xlsx' | 'pdf';

    /** Whether to include in generation */
    enabled: boolean;

    /** Questions specific to this template */
    requiredQuestions: string[];
}

/**
 * Hospital-specific configuration for transfer documents
 */
export interface HospitalConfig {
    /** Unique identifier (slug) */
    id: string;

    /** Display name */
    name: string;

    /** Short code */
    code: string;

    /** Email addresses for sending documents */
    emails: {
        to: string[];
        cc: string[];
    };

    /** Questions to ask for this hospital */
    questions: TransferQuestion[];

    /** Document templates for this hospital */
    templates: DocumentTemplate[];

    /** Staff members for dropdown options */
    staff?: {
        nurses: string[];
        doctors: string[];
    };
}

// ============================================================================
// Patient Data for Templates (Auto-filled)
// ============================================================================

/**
 * Patient data extracted from the system for auto-filling templates
 */
export interface TransferPatientData {
    /** Patient full name */
    patientName: string;

    /** Patient RUT */
    rut: string;

    /** Birth date */
    birthDate?: string;

    /** Patient age (in years) - used if birthDate is not available */
    age?: number;

    /** Main diagnosis */
    diagnosis?: string;

    /** Admission date */
    admissionDate?: string;

    /** Current bed */
    bedName: string;

    /** Bed type (Básica, UTI, etc) */
    bedType: string;

    /** Is in UPC */
    isUPC: boolean;

    /** Origin hospital */
    originHospital: string;
}

// ============================================================================
// Document Generation Types
// ============================================================================

/**
 * Generated document ready for download
 */
export interface GeneratedDocument {
    /** Template ID this was generated from */
    templateId: string;

    /** File name for download */
    fileName: string;

    /** MIME type */
    mimeType: string;

    /** File content as Blob */
    blob: Blob;

    /** Generation timestamp */
    generatedAt: string;
}

/**
 * Complete transfer document package
 */
export interface TransferDocumentPackage {
    /** Hospital this was generated for */
    hospitalId: string;

    /** Patient data used */
    patientData: TransferPatientData;

    /** Questionnaire responses */
    responses: QuestionnaireResponse;

    /** Generated documents */
    documents: GeneratedDocument[];

    /** Package creation timestamp */
    createdAt: string;
}
