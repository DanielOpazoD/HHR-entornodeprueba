/**
 * Zod Schemas for Data Validation
 * 
 * These schemas validate data coming from Firebase or localStorage
 * to ensure type safety and catch corrupted/malformed data.
 */

import { z } from 'zod';
import { PatientData, Specialty, PatientStatus, DischargeData, TransferData, CMAData, DailyRecord, CudyrScore } from '../types';

// ============================================================================
// Constants & Regex
// ============================================================================

const RUT_REGEX = /^(\d{1,2}\.?\d{3}\.?\d{3}[-]?[\dkK])?$/; // Chilean RUT format (optional)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD format

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Helper for fields that can be null in Firestore (empty) but should be undefined in the app
 */
const nullableOptional = <T extends z.ZodTypeAny>(schema: T) =>
    schema.nullable().optional().transform(v => v ?? undefined);

// ============================================================================
// Enums
// ============================================================================

export const BedTypeSchema = z.enum(['UTI', 'MEDIA']);
export const PatientStatusSchema = z.nativeEnum(PatientStatus);

// ============================================================================
// Specialties
// ============================================================================

const SpecialtyEnumSchema = z.nativeEnum(Specialty);
export const SpecialtySchema = z.preprocess((val) => {
    // Migrate legacy values to the new combined specialty
    if (val === 'Ginecología' || val === 'Obstetricia') {
        return Specialty.GINECOBSTETRICIA;
    }
    return val;
}, SpecialtyEnumSchema);

// ============================================================================
// Sub-schemas
// ============================================================================

export const CudyrScoreSchema = z.object({
    changeClothes: z.number().default(0),
    mobilization: z.number().default(0),
    feeding: z.number().default(0),
    elimination: z.number().default(0),
    psychosocial: z.number().default(0),
    surveillance: z.number().default(0),
    vitalSigns: z.number().default(0),
    fluidBalance: z.number().default(0),
    oxygenTherapy: z.number().default(0),
    airway: z.number().default(0),
    proInterventions: z.number().default(0),
    skinCare: z.number().default(0),
    pharmacology: z.number().default(0),
    invasiveElements: z.number().default(0),
});

export const DeviceInfoSchema = z.object({
    installationDate: z.string().optional(),
    removalDate: z.string().optional(),
    note: z.string().optional(),
});

export const DeviceDetailsSchema = z.object({
    CUP: DeviceInfoSchema.optional(),
    CVC: DeviceInfoSchema.optional(),
    VMI: DeviceInfoSchema.optional(),
    'VVP#1': DeviceInfoSchema.optional(),
    'VVP#2': DeviceInfoSchema.optional(),
    'VVP#3': DeviceInfoSchema.optional(),
}).catchall(DeviceInfoSchema);

export const ClinicalEventSchema = z.object({
    id: z.string(),
    name: z.string(),
    date: z.string(),
    note: z.string().optional(),
    createdAt: z.string(),
}).passthrough();

export const FhirResourceSchema = z.object({
    resourceType: z.string(),
    id: nullableOptional(z.string()),
    meta: nullableOptional(z.object({
        profile: nullableOptional(z.array(z.string())),
    })),
}).passthrough();

// ============================================================================
// Main PatientData Schema (Recursive)
// ============================================================================

export const PatientDataSchema: z.ZodType<PatientData, z.ZodTypeDef, unknown> = z.lazy(() =>
    z.object({
        bedId: z.string().default(''),
        isBlocked: z.boolean().default(false),
        blockedReason: nullableOptional(z.string()),
        bedMode: z.enum(['Cama', 'Cuna']).default('Cama'),
        hasCompanionCrib: z.boolean().default(false),
        clinicalCrib: z.lazy(() => PatientDataSchema).nullable().optional().transform(v => v ?? undefined),
        patientName: z.string().default(''),
        rut: z.string().regex(RUT_REGEX, 'Formato de RUT inválido').default(''),
        documentType: nullableOptional(z.enum(['RUT', 'Pasaporte'])),
        age: z.string().default(''),
        birthDate: nullableOptional(z.string()),
        biologicalSex: nullableOptional(z.enum(['Masculino', 'Femenino', 'Indeterminado'])),
        insurance: nullableOptional(z.enum(['Fonasa', 'Isapre', 'Particular'])),
        admissionOrigin: nullableOptional(z.enum(['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro'])),
        admissionOriginDetails: nullableOptional(z.string()),
        origin: nullableOptional(z.enum(['Residente', 'Turista Nacional', 'Turista Extranjero'])),
        isRapanui: nullableOptional(z.boolean()),
        pathology: z.string().default(''),
        snomedCode: nullableOptional(z.string()),
        cie10Code: nullableOptional(z.string()),
        cie10Description: nullableOptional(z.string()),
        diagnosisComments: nullableOptional(z.string()),
        specialty: SpecialtySchema.default(Specialty.EMPTY),
        status: z.nativeEnum(PatientStatus).default(PatientStatus.EMPTY),
        admissionDate: z.string().default(''),
        admissionTime: z.string().default(''),
        hasWristband: z.boolean().default(true),
        devices: z.array(z.string()).default([]),
        deviceDetails: nullableOptional(DeviceDetailsSchema),
        surgicalComplication: z.boolean().default(false),
        isUPC: z.boolean().default(false),
        location: nullableOptional(z.string()),
        cudyr: nullableOptional(CudyrScoreSchema),
        handoffNote: nullableOptional(z.string()),
        handoffNoteDayShift: nullableOptional(z.string()),
        handoffNoteNightShift: nullableOptional(z.string()),
        medicalHandoffNote: nullableOptional(z.string()),
        clinicalEvents: z.array(ClinicalEventSchema).default([]),
        fhir_resource: nullableOptional(FhirResourceSchema),
    }).passthrough()
);

// ============================================================================
// Discharge & Transfer Schemas
// ============================================================================

export const DischargeDataSchema: z.ZodType<DischargeData> = z.object({
    id: z.string(),
    bedName: z.string().default(''),
    bedId: z.string().default(''),
    bedType: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    diagnosis: z.string().default(''),
    time: z.string().default(''),
    status: z.enum(['Vivo', 'Fallecido']).default('Vivo'),
    dischargeType: z.enum(['Domicilio (Habitual)', 'Voluntaria', 'Fuga', 'Otra']).optional(),
    dischargeTypeOther: z.string().optional(),
    age: z.string().optional(),
    insurance: z.string().optional(),
    origin: z.string().optional(),
    isRapanui: z.boolean().optional(),
    originalData: PatientDataSchema.optional(),
    isNested: z.boolean().optional(),
}).passthrough();

export const TransferDataSchema: z.ZodType<TransferData, z.ZodTypeDef, unknown> = z.object({
    id: z.string(),
    bedName: z.string().default(''),
    bedId: z.string().default(''),
    bedType: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    diagnosis: z.string().default(''),
    time: z.string().default(''),
    evacuationMethod: z.string().default(''),
    receivingCenter: z.string().default(''),
    receivingCenterOther: z.string().optional(),
    transferEscort: z.string().optional(),
    age: z.string().optional(),
    insurance: z.string().optional(),
    origin: z.string().optional(),
    isRapanui: z.boolean().optional(),
    originalData: PatientDataSchema.optional(),
    isNested: z.boolean().optional(),
}).passthrough();

export const CMADataSchema: z.ZodType<CMAData, z.ZodTypeDef, unknown> = z.object({
    id: z.string(),
    bedName: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    age: z.string().default(''),
    diagnosis: z.string().default(''),
    specialty: z.nativeEnum(Specialty).default(Specialty.EMPTY),
    interventionType: z.enum(['Cirugía Mayor Ambulatoria', 'Procedimiento Médico Ambulatorio']).default('Cirugía Mayor Ambulatoria'),
    enteredBy: z.string().optional(),
    timestamp: z.string().optional(),
}).passthrough();

// ============================================================================
// DailyRecord Schema
// ============================================================================

export const DailyRecordSchema: z.ZodType<DailyRecord> = z.object({
    date: z.string(),
    beds: z.record(z.string(), PatientDataSchema).default({}),
    discharges: z.array(DischargeDataSchema).default([]),
    transfers: z.array(TransferDataSchema).default([]),
    cma: z.array(CMADataSchema).default([]),
    lastUpdated: z.string().default(() => new Date().toISOString()),
    dateTimestamp: z.number().optional(),
    schemaVersion: z.number().default(1),
    nurses: z.array(z.string()).default(['', '']),
    nurseName: z.string().optional(),
    nursesDayShift: z.array(z.string()).optional(),
    nursesNightShift: z.array(z.string()).optional(),
    tensDayShift: z.array(z.string()).optional(),
    tensNightShift: z.array(z.string()).optional(),
    activeExtraBeds: z.array(z.string()).default([]),
    handoffDayChecklist: z.object({
        escalaBraden: z.boolean().optional(),
        escalaRiesgoCaidas: z.boolean().optional(),
        escalaRiesgoLPP: z.boolean().optional(),
    }).optional(),
    handoffNightChecklist: z.object({
        estadistica: z.boolean().optional(),
        categorizacionCudyr: z.boolean().optional(),
        encuestaUTI: z.boolean().optional(),
        encuestaMedias: z.boolean().optional(),
        conteoMedicamento: z.boolean().optional(),
        conteoNoControlados: z.boolean().optional(),
        conteoNoControladosProximaFecha: z.string().optional(),
    }).optional(),
    handoffNovedadesDayShift: z.string().optional(),
    handoffNovedadesNightShift: z.string().optional(),
    medicalHandoffNovedades: z.string().optional(),
    medicalHandoffDoctor: z.string().optional(),
    medicalHandoffSentAt: z.string().optional(),
    medicalSignature: z.object({
        doctorName: z.string(),
        signedAt: z.string(),
        userAgent: z.string().optional()
    }).optional(),
    cudyrLocked: z.boolean().optional(),
    cudyrLockedAt: z.string().optional(),
    cudyrLockedBy: z.string().optional(),
    handoffNightReceives: z.array(z.string()).optional(),
}).passthrough();

/**
 * Full backup schema for import/export
 */
export const FullBackupSchema = z.record(z.string(), DailyRecordSchema);

// ============================================================================
// Validation Helpers & Types
// ============================================================================

export interface ValidationResult<T> {
    success: boolean;
    data?: T;
    errors?: string[];
}

export const validatePatientData = (data: unknown): ValidationResult<PatientData> => {
    const result = PatientDataSchema.safeParse(data);
    return result.success ? { success: true, data: result.data } : {
        success: false,
        errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
    };
};

export const validateDailyRecord = (data: unknown): ValidationResult<DailyRecord> => {
    const result = DailyRecordSchema.safeParse(data);
    return result.success ? { success: true, data: result.data as DailyRecord } : {
        success: false,
        errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
    };
};

export const validateBackupData = (data: unknown): ValidationResult<Record<string, DailyRecord>> => {
    const result = FullBackupSchema.safeParse(data);
    return result.success ? { success: true, data: result.data as Record<string, DailyRecord> } : {
        success: false,
        errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
    };
};

export const validateRut = (rut: string): boolean => {
    if (!rut || rut.trim() === '') return true;
    return RUT_REGEX.test(rut);
};

export const validateAdmissionDate = (dateStr: string): ValidationResult<string> => {
    if (!dateStr || dateStr.trim() === '') return { success: true, data: '' };
    if (!DATE_REGEX.test(dateStr)) return { success: false, errors: ['Formato de fecha inválido (YYYY-MM-DD)'] };
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return date > today ? { success: false, errors: ['La fecha de ingreso no puede ser futura'] } : { success: true, data: dateStr };
};

export const validateCudyrScore = (score: unknown): ValidationResult<CudyrScore> => {
    const result = CudyrScoreSchema.safeParse(score);
    return result.success ? { success: true, data: result.data } : {
        success: false,
        errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
    };
};

export type PatientDataValidated = z.infer<typeof PatientDataSchema>;
export type DailyRecordValidated = z.infer<typeof DailyRecordSchema>;
export type CudyrScoreValidated = z.infer<typeof CudyrScoreSchema>;
export type DischargeDataValidated = z.infer<typeof DischargeDataSchema>;
export type TransferDataValidated = z.infer<typeof TransferDataSchema>;

// ============================================================================
// Safe Parsing Utilities
// ============================================================================

export const safeParseDailyRecord = (data: unknown): DailyRecord | null => {
    const result = DailyRecordSchema.safeParse(data);
    if (result.success) return result.data as DailyRecord;
    console.warn('⚠️ DailyRecord validation failed:', result.error.issues);
    return null;
};

export const parseDailyRecordWithDefaults = (data: unknown, docId: string): DailyRecord => {
    try {
        const result = DailyRecordSchema.safeParse(data);
        if (result.success) return result.data as DailyRecord;
        console.warn('⚠️ DailyRecord partial validation failure for date:', docId, result.error.issues.slice(0, 5));
    } catch (err) {
        console.warn('⚠️ Unexpected error parsing DailyRecord for date:', docId, err);
    }

    const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const salvagedBeds: Record<string, PatientData> = {};
    if (raw.beds && typeof raw.beds === 'object' && !Array.isArray(raw.beds)) {
        Object.entries(raw.beds as Record<string, unknown>).forEach(([id, patient]) => {
            const parsed = PatientDataSchema.safeParse(patient);
            salvagedBeds[id] = parsed.success ? parsed.data : (patient as PatientData || { bedId: id });
        });
    }

    return {
        date: typeof raw.date === 'string' ? raw.date : docId,
        beds: salvagedBeds,
        discharges: Array.isArray(raw.discharges) ? raw.discharges : [],
        transfers: Array.isArray(raw.transfers) ? raw.transfers : [],
        cma: Array.isArray(raw.cma) ? raw.cma : [],
        lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : new Date().toISOString(),
        nurses: Array.isArray(raw.nurses) ? raw.nurses : ['', ''],
        nursesDayShift: Array.isArray(raw.nursesDayShift) ? raw.nursesDayShift : ['', ''],
        nursesNightShift: Array.isArray(raw.nursesNightShift) ? raw.nursesNightShift : ['', ''],
        tensDayShift: Array.isArray(raw.tensDayShift) ? raw.tensDayShift : ['', '', ''],
        tensNightShift: Array.isArray(raw.tensNightShift) ? raw.tensNightShift : ['', '', ''],
        activeExtraBeds: Array.isArray(raw.activeExtraBeds) ? raw.activeExtraBeds : [],
        handoffDayChecklist: (raw.handoffDayChecklist as DailyRecord['handoffDayChecklist']) || {},
        handoffNightChecklist: (raw.handoffNightChecklist as DailyRecord['handoffNightChecklist']) || {},
        handoffNovedadesDayShift: typeof raw.handoffNovedadesDayShift === 'string' ? raw.handoffNovedadesDayShift : '',
        handoffNovedadesNightShift: typeof raw.handoffNovedadesNightShift === 'string' ? raw.handoffNovedadesNightShift : '',
        medicalHandoffNovedades: typeof raw.medicalHandoffNovedades === 'string' ? raw.medicalHandoffNovedades : '',
        handoffNightReceives: Array.isArray(raw.handoffNightReceives) ? raw.handoffNightReceives : [],
        schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
    } as DailyRecord;
};
