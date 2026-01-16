import { z } from 'zod';

// ============================================================
// CONSTANTS FOR VALIDATION
// ============================================================

const RUT_REGEX = /^(\d{1,2}\.?\d{3}\.?\d{3}[-]?[\dkK])?$/; // Chilean RUT format (optional)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD format

// ============================================================
// ENUM SCHEMAS (mirroring types.ts enums for runtime validation)
// ============================================================

export const BedTypeSchema = z.enum(['UTI', 'MEDIA']);

export const SpecialtySchema = z.enum([
  'Med Interna',
  'Cirugía',
  'Traumatología',
  'Ginecobstetricia',
  'Psiquiatría',
  'Pediatría',
  'Otro',
  ''
]);

export const PatientStatusSchema = z.enum([
  'Grave',
  'De cuidado',
  'Estable',
  ''
]);

// ============================================================
// CUDYR SCORE SCHEMA
// ============================================================

export const CudyrScoreSchema = z.object({
  // Dependencia (6 items) - values 0-4
  changeClothes: z.number().min(0).max(4),
  mobilization: z.number().min(0).max(4),
  feeding: z.number().min(0).max(4),
  elimination: z.number().min(0).max(4),
  psychosocial: z.number().min(0).max(4),
  surveillance: z.number().min(0).max(4),
  // Riesgo (8 items) - values 0-4
  vitalSigns: z.number().min(0).max(4),
  fluidBalance: z.number().min(0).max(4),
  oxygenTherapy: z.number().min(0).max(4),
  airway: z.number().min(0).max(4),
  proInterventions: z.number().min(0).max(4),
  skinCare: z.number().min(0).max(4),
  pharmacology: z.number().min(0).max(4),
  invasiveElements: z.number().min(0).max(4),
});

// ============================================================
// CLINICAL EVENT SCHEMA
// ============================================================

export const ClinicalEventSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Nombre del evento requerido'),
  date: z.string().regex(DATE_REGEX, 'Formato de fecha inválido (YYYY-MM-DD)'),
  note: z.string().optional(),
  createdAt: z.string(),
});

// ============================================================
// PATIENT DATA SCHEMA
// ============================================================

// Base Patient Schema without recursion
const BasePatientSchema = z.object({
  bedId: z.string().min(1, 'Bed ID is required'),
  isBlocked: z.boolean(),
  blockedReason: z.string().optional(),

  // Furniture configuration
  bedMode: z.enum(['Cama', 'Cuna']).default('Cama'),
  hasCompanionCrib: z.boolean().default(false),

  // Patient identification
  patientName: z.string().optional(),
  rut: z.string().regex(RUT_REGEX, 'Formato de RUT inválido').optional().or(z.literal('')),
  documentType: z.enum(['RUT', 'Pasaporte']).optional(),
  age: z.string().optional(),
  birthDate: z.string().optional(),
  biologicalSex: z.enum(['Masculino', 'Femenino', 'Indeterminado']).optional(),
  insurance: z.enum(['Fonasa', 'Isapre', 'Particular']).optional(),

  // Admission details
  admissionOrigin: z.enum(['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro']).optional(),
  admissionOriginDetails: z.string().optional(),
  origin: z.enum(['Residente', 'Turista Nacional', 'Turista Extranjero']).optional(),

  // Clinical data
  isRapanui: z.boolean().optional(),
  pathology: z.string().optional(),
  diagnosisComments: z.string().optional(),
  specialty: SpecialtySchema.optional(),
  status: PatientStatusSchema.optional(),
  admissionDate: z.string().regex(DATE_REGEX, 'Formato de fecha inválido (YYYY-MM-DD)').optional().or(z.literal('')),
  admissionTime: z.string().optional(),
  hasWristband: z.boolean(),
  devices: z.array(z.string()),
  surgicalComplication: z.boolean(),
  isUPC: z.boolean(),
  location: z.string().optional(),
  cudyr: CudyrScoreSchema.optional(),

  // Clinical Events
  clinicalEvents: z.array(ClinicalEventSchema).optional(),

  // Nursing notes
  handoffNote: z.string().optional()
});

// Extended Schema with recursive clinicalCrib
export const PatientDataSchema: z.ZodType<any> = BasePatientSchema.extend({
  clinicalCrib: z.lazy(() => PatientDataSchema.optional())
});

// ============================================================
// DISCHARGE DATA SCHEMA
// ============================================================

export const DischargeDataSchema = z.object({
  id: z.string().min(1),
  bedName: z.string(),
  bedId: z.string(),
  bedType: z.string(),
  patientName: z.string().optional(),
  rut: z.string().optional(),
  diagnosis: z.string().optional(),
  time: z.string().default(''),
  status: z.enum(['Vivo', 'Fallecido']),
  age: z.string().optional(),
  insurance: z.string().optional(),
  origin: z.string().optional(),
  isRapanui: z.boolean().optional(),
  originalData: z.lazy(() => PatientDataSchema.optional()),
  isNested: z.boolean().optional()
});

// ============================================================
// TRANSFER DATA SCHEMA
// ============================================================

export const TransferDataSchema = z.object({
  id: z.string().min(1),
  bedName: z.string(),
  bedId: z.string(),
  bedType: z.string(),
  patientName: z.string().optional(),
  rut: z.string().optional(),
  diagnosis: z.string().optional(),
  time: z.string().default(''),
  evacuationMethod: z.string(),
  receivingCenter: z.string(),
  receivingCenterOther: z.string().optional(),
  transferEscort: z.string().optional(),
  age: z.string().optional(),
  insurance: z.string().optional(),
  origin: z.string().optional(),
  isRapanui: z.boolean().optional(),
  originalData: z.lazy(() => PatientDataSchema.optional()),
  isNested: z.boolean().optional()
});

// ============================================================
// DAILY RECORD SCHEMA
// ============================================================

export const DailyRecordSchema = z.object({
  date: z.string().regex(DATE_REGEX, 'Formato de fecha inválido'),
  beds: z.record(PatientDataSchema),
  discharges: z.array(DischargeDataSchema).default([]),
  transfers: z.array(TransferDataSchema).default([]),
  cma: z.array(z.any()).default([]),
  lastUpdated: z.string(),
  nurses: z.array(z.string()).default([]),
  nurseName: z.string().optional(),
  activeExtraBeds: z.array(z.string()).default([]),

  // ===== Shift-based Staff =====
  nursesDayShift: z.array(z.string()).optional(),
  nursesNightShift: z.array(z.string()).optional(),
  tensDayShift: z.array(z.string()).optional(),
  tensNightShift: z.array(z.string()).optional(),

  // ===== Handoff Checklist - Day Shift =====
  handoffDayChecklist: z.record(z.any()).optional(),
  handoffNovedadesDayShift: z.string().optional(),

  // ===== Handoff Checklist - Night Shift =====
  handoffNightChecklist: z.record(z.any()).optional(),
  handoffNovedadesNightShift: z.string().optional(),
  handoffNightReceives: z.array(z.string()).optional(),

  // ===== Medical Handoff =====
  medicalHandoffDoctor: z.string().optional(),
  medicalHandoffSentAt: z.string().optional(),
  medicalSignature: z.object({
    doctorName: z.string(),
    signedAt: z.string(),
    userAgent: z.string().optional()
  }).optional()
}).passthrough(); // Allow additional fields to pass through without being stripped

// ============================================================
// FULL BACKUP SCHEMA
// ============================================================

export const FullBackupSchema = z.record(DailyRecordSchema);

// ============================================================
// VALIDATION HELPER FUNCTIONS
// ============================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: string[];
}

/**
 * Validate patient data
 */
export const validatePatientData = (data: unknown): ValidationResult<z.infer<typeof PatientDataSchema>> => {
  const result = PatientDataSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
};

/**
 * Validate daily record
 */
export const validateDailyRecord = (data: unknown): ValidationResult<z.infer<typeof DailyRecordSchema>> => {
  const result = DailyRecordSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
};

/**
 * Validate full backup data (for import)
 */
export const validateBackupData = (data: unknown): ValidationResult<z.infer<typeof FullBackupSchema>> => {
  const result = FullBackupSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
};

/**
 * Validate RUT format
 */
export const validateRut = (rut: string): boolean => {
  if (!rut || rut.trim() === '') return true; // Empty is valid (optional)
  return RUT_REGEX.test(rut);
};

/**
 * Validate admission date (cannot be in future)
 */
export const validateAdmissionDate = (dateStr: string): ValidationResult<string> => {
  if (!dateStr || dateStr.trim() === '') {
    return { success: true, data: '' };
  }

  if (!DATE_REGEX.test(dateStr)) {
    return { success: false, errors: ['Formato de fecha inválido (YYYY-MM-DD)'] };
  }

  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  if (date > today) {
    return { success: false, errors: ['La fecha de ingreso no puede ser futura'] };
  }

  return { success: true, data: dateStr };
};

/**
 * Validate CUDYR score values
 */
export const validateCudyrScore = (score: unknown): ValidationResult<z.infer<typeof CudyrScoreSchema>> => {
  const result = CudyrScoreSchema.safeParse(score);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
};

// ============================================================
// TYPE EXPORTS (inferred from schemas)
// ============================================================

export type PatientDataValidated = z.infer<typeof PatientDataSchema>;
export type DailyRecordValidated = z.infer<typeof DailyRecordSchema>;
export type CudyrScoreValidated = z.infer<typeof CudyrScoreSchema>;
export type DischargeDataValidated = z.infer<typeof DischargeDataSchema>;
export type TransferDataValidated = z.infer<typeof TransferDataSchema>;

