/**
 * Zod Schemas for Data Validation
 * 
 * These schemas validate data coming from Firebase or localStorage
 * to ensure type safety and catch corrupted/malformed data.
 */

import { z } from 'zod';
import { PatientData, Specialty, PatientStatus, DischargeData, TransferData, CMAData, DailyRecord, CudyrScore, BedType } from '@/types';

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

export const BedTypeSchema = z.nativeEnum(BedType) as z.ZodType<BedType>;
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
    changeClothes: z.number().min(0).max(4).catch(0),
    mobilization: z.number().min(0).max(4).catch(0),
    feeding: z.number().min(0).max(4).catch(0),
    elimination: z.number().min(0).max(4).catch(0),
    psychosocial: z.number().min(0).max(4).catch(0),
    surveillance: z.number().min(0).max(4).catch(0),
    vitalSigns: z.number().min(0).max(4).catch(0),
    fluidBalance: z.number().min(0).max(4).catch(0),
    oxygenTherapy: z.number().min(0).max(4).catch(0),
    airway: z.number().min(0).max(4).catch(0),
    proInterventions: z.number().min(0).max(4).catch(0),
    skinCare: z.number().min(0).max(4).catch(0),
    pharmacology: z.number().min(0).max(4).catch(0),
    invasiveElements: z.number().min(0).max(4).catch(0),
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
        rut: z.string().default(''),
        documentType: nullableOptional(z.preprocess(v => v === '' ? undefined : v, z.enum(['RUT', 'Pasaporte']).optional())),
        age: z.string().default(''),
        birthDate: nullableOptional(z.string()),
        biologicalSex: nullableOptional(z.preprocess(v => v === '' ? undefined : v, z.enum(['Masculino', 'Femenino', 'Indeterminado']).optional())),
        insurance: nullableOptional(z.preprocess(v => v === '' ? undefined : v, z.enum(['Fonasa', 'Isapre', 'Particular']).optional())),
        admissionOrigin: nullableOptional(z.preprocess(v => v === '' ? undefined : v, z.enum(['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro']).optional())),
        admissionOriginDetails: nullableOptional(z.string()),
        origin: nullableOptional(z.preprocess(v => v === '' ? undefined : v, z.enum(['Residente', 'Turista Nacional', 'Turista Extranjero']).optional())),
        isRapanui: nullableOptional(z.boolean()),
        pathology: z.string().default(''),
        snomedCode: nullableOptional(z.string()),
        cie10Code: nullableOptional(z.string()),
        cie10Description: nullableOptional(z.string()),
        diagnosisComments: nullableOptional(z.string()),
        specialty: SpecialtySchema.default(Specialty.EMPTY),
        secondarySpecialty: nullableOptional(z.union([z.nativeEnum(Specialty), z.string()])),
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

export const DischargeDataSchema: z.ZodType<DischargeData, z.ZodTypeDef, unknown> = z.object({
    id: z.string(),
    bedName: z.string().default(''),
    bedId: z.string().default(''),
    bedType: z.string().default(''),
    patientName: z.string().default(''),
    rut: z.string().default(''),
    diagnosis: z.string().default(''),
    time: z.string().default(''),
    status: z.enum(['Vivo', 'Fallecido']).default('Vivo'),
    dischargeType: nullableOptional(z.enum(['Domicilio (Habitual)', 'Voluntaria', 'Fuga', 'Otra'])),
    dischargeTypeOther: nullableOptional(z.string()),
    age: nullableOptional(z.string()),
    insurance: nullableOptional(z.string()),
    origin: nullableOptional(z.string()),
    isRapanui: nullableOptional(z.boolean()),
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
    receivingCenterOther: nullableOptional(z.string()),
    transferEscort: nullableOptional(z.string()),
    age: nullableOptional(z.string()),
    insurance: nullableOptional(z.string()),
    origin: nullableOptional(z.string()),
    isRapanui: nullableOptional(z.boolean()),
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
    dischargeTime: nullableOptional(z.string()),
    enteredBy: nullableOptional(z.string()),
    timestamp: nullableOptional(z.string()),
    originalBedId: nullableOptional(z.string()),
    originalData: PatientDataSchema.optional(),
}).passthrough();

// ============================================================================
// DailyRecord Schema
// ============================================================================

export const DailyRecordSchema: z.ZodType<DailyRecord, z.ZodTypeDef, unknown> = z.object({
    date: z.string().regex(DATE_REGEX),
    beds: z.record(z.string(), PatientDataSchema).default({}),
    bedTypeOverrides: z.preprocess(
        (val) => {
            if (!val || typeof val !== 'object') return {};
            const record: Record<string, unknown> = { ...(val as Record<string, unknown>) };
            // Filter out null/undefined values which might come from Firestore deletes or reverts
            Object.keys(record).forEach(key => {
                if (record[key] === null || record[key] === undefined) delete record[key];
            });
            return record;
        },
        z.record(z.string(), BedTypeSchema)
    ).default({}),
    discharges: z.array(DischargeDataSchema).default([]),
    transfers: z.array(TransferDataSchema).default([]),
    cma: z.array(CMADataSchema).default([]),
    lastUpdated: z.string().default(() => new Date().toISOString()),
    dateTimestamp: z.number().optional(),
    schemaVersion: z.number().default(1),
    nurses: z.array(z.string()).default(['', '']),
    nurseName: z.string().optional(),
    nursesDayShift: z.array(z.string()).default(['', '']),
    nursesNightShift: z.array(z.string()).default(['', '']),
    tensDayShift: z.array(z.string()).default(['', '', '']),
    tensNightShift: z.array(z.string()).default(['', '', '']),
    activeExtraBeds: z.array(z.string()).default([]),
    handoffDayChecklist: z.object({
        escalaBraden: z.boolean().optional(),
        escalaRiesgoCaidas: z.boolean().optional(),
        escalaRiesgoLPP: z.boolean().optional(),
    }).default({}),
    handoffNightChecklist: z.object({
        estadistica: z.boolean().optional(),
        categorizacionCudyr: z.boolean().optional(),
        encuestaUTI: z.boolean().optional(),
        encuestaMedias: z.boolean().optional(),
        conteoMedicamento: z.boolean().optional(),
        conteoNoControlados: z.boolean().optional(),
        conteoNoControladosProximaFecha: z.string().optional(),
    }).default({}),
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
    handoffNightReceives: z.array(z.string()).default([]),
    onDutyProfessionals: z.array(z.object({
        specialty: z.enum(['Medicina Interna', 'Cirugía', 'Ginecobstetricia', 'Anestesia', 'Kinesiología']),
        name: z.string(),
        phone: z.string(),
        period: z.string(),
    })).default([]),
    onDutyProfessionalsUpdatedAt: z.string().optional(),
    onDutyCoverageStart: z.string().optional(),
    onDutyCoverageEnd: z.string().optional(),
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
        // console.debug('⚠️ DailyRecord partial validation failure for date:', docId, result.error.issues.slice(0, 3));
    } catch (_err) {
        // console.debug('⚠️ Unexpected error parsing DailyRecord for date:', docId, _err);
    }

    const raw = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const salvagedBeds: Record<string, PatientData> = {};
    if (raw.beds && typeof raw.beds === 'object' && !Array.isArray(raw.beds)) {
        Object.entries(raw.beds as Record<string, unknown>).forEach(([id, patient]) => {
            const parsed = PatientDataSchema.safeParse(patient);
            salvagedBeds[id] = parsed.success ? parsed.data : (patient as PatientData || { bedId: id });
        });
    }

    const salvagedDischarges: DischargeData[] = [];
    if (Array.isArray(raw.discharges)) {
        raw.discharges.forEach((item) => {
            const parsed = DischargeDataSchema.safeParse(item);
            if (parsed.success) salvagedDischarges.push(parsed.data);
            else console.warn('⚠️ Discharge item salvage failed:', parsed.error.issues);
        });
    }

    const salvagedTransfers: TransferData[] = [];
    if (Array.isArray(raw.transfers)) {
        raw.transfers.forEach((item) => {
            const parsed = TransferDataSchema.safeParse(item);
            if (parsed.success) salvagedTransfers.push(parsed.data);
            else console.warn('⚠️ Transfer item salvage failed:', parsed.error.issues);
        });
    }

    const salvagedCMA: CMAData[] = [];
    if (Array.isArray(raw.cma)) {
        raw.cma.forEach((item) => {
            const parsed = CMADataSchema.safeParse(item);
            if (parsed.success) salvagedCMA.push(parsed.data);
            else console.warn('⚠️ CMA item salvage failed:', parsed.error.issues);
        });
    }

    return {
        date: typeof raw.date === 'string' ? raw.date : docId,
        beds: salvagedBeds,
        discharges: salvagedDischarges,
        transfers: salvagedTransfers,
        cma: salvagedCMA,
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
        onDutyProfessionals: Array.isArray(raw.onDutyProfessionals) ? raw.onDutyProfessionals : [],
        onDutyProfessionalsUpdatedAt: typeof raw.onDutyProfessionalsUpdatedAt === 'string' ? raw.onDutyProfessionalsUpdatedAt : undefined,
        onDutyCoverageStart: typeof raw.onDutyCoverageStart === 'string' ? raw.onDutyCoverageStart : undefined,
        onDutyCoverageEnd: typeof raw.onDutyCoverageEnd === 'string' ? raw.onDutyCoverageEnd : undefined,
        bedTypeOverrides: (raw.bedTypeOverrides as Record<string, BedType>) || {},
        schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
    } as DailyRecord;
};
