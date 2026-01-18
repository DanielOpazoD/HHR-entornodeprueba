/**
 * Validation Schemas Index
 * Centralized exports for all Zod schemas and validation helpers
 */

export {
    // Enum Schemas
    BedTypeSchema,
    SpecialtySchema,
    PatientStatusSchema,

    // Data Schemas
    CudyrScoreSchema,
    PatientDataSchema,
    DischargeDataSchema,
    TransferDataSchema,
    DailyRecordSchema,
    FullBackupSchema,

    // Validation Helpers
    validatePatientData,
    validateDailyRecord,
    validateBackupData,
    validateRut,
    validateAdmissionDate,
    validateCudyrScore,

    // Types
    type ValidationResult,
    type PatientDataValidated,
    type DailyRecordValidated,
    type CudyrScoreValidated,
    type DischargeDataValidated,
    type TransferDataValidated
} from './zodSchemas';
