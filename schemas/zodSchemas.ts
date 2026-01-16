/**
 * Zod Schemas for Data Validation
 * 
 * These schemas validate data coming from Firebase or localStorage
 * to ensure type safety and catch corrupted/malformed data.
 */

import { z } from 'zod';
import { PatientData, Specialty, PatientStatus } from '../types';

// ============================================================================
// Enums
// ============================================================================

export const BedTypeSchema = z.enum(['UTI', 'MEDIA']);
export const SpecialtySchema = z.nativeEnum(Specialty);
export const PatientStatusSchema = z.nativeEnum(PatientStatus);

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
});

// ============================================================================
// FHIR Core-CL Schemas
// ============================================================================

export const FhirResourceSchema = z.object({
    resourceType: z.string(),
    id: z.string().optional(),
    meta: z.object({
        profile: z.array(z.string()).optional(),
    }).optional(),
}).passthrough();

// ============================================================================
// PatientData Schema
// ============================================================================

// Forward declare for recursive type (clinicalCrib) with explicit type for better inference
export const PatientDataSchema: z.ZodType<PatientData, z.ZodTypeDef, any> = z.lazy(() =>
    z.object({
        bedId: z.string().default(''),
        isBlocked: z.boolean().default(false),
        blockedReason: z.string().optional(),
        bedMode: z.enum(['Cama', 'Cuna']).default('Cama'),
        hasCompanionCrib: z.boolean().default(false),
        clinicalCrib: PatientDataSchema.optional(),
        patientName: z.string().default(''),
        rut: z.string().default(''),
        documentType: z.enum(['RUT', 'Pasaporte']).optional(),
        age: z.string().default(''),
        birthDate: z.string().optional(),
        biologicalSex: z.enum(['Masculino', 'Femenino', 'Indeterminado']).optional(),
        insurance: z.enum(['Fonasa', 'Isapre', 'Particular']).optional(),
        admissionOrigin: z.enum(['CAE', 'APS', 'Urgencias', 'Pabellón', 'Otro']).optional(),
        admissionOriginDetails: z.string().optional(),
        origin: z.enum(['Residente', 'Turista Nacional', 'Turista Extranjero']).optional(),
        isRapanui: z.boolean().optional(),
        pathology: z.string().default(''),
        snomedCode: z.string().optional(),
        cie10Code: z.string().optional(),
        diagnosisComments: z.string().optional(),
        specialty: z.nativeEnum(Specialty).default(Specialty.EMPTY),
        status: z.nativeEnum(PatientStatus).default(PatientStatus.EMPTY),
        admissionDate: z.string().default(''),
        admissionTime: z.string().default(''),
        hasWristband: z.boolean().default(true),
        devices: z.array(z.string()).default([]),
        deviceDetails: DeviceDetailsSchema.optional(),
        surgicalComplication: z.boolean().default(false),
        isUPC: z.boolean().default(false),
        location: z.string().optional(),
        cudyr: CudyrScoreSchema.optional(),
        handoffNote: z.string().optional(),
        handoffNoteDayShift: z.string().optional(),
        handoffNoteNightShift: z.string().optional(),
        medicalHandoffNote: z.string().optional(),
        fhir_resource: FhirResourceSchema.optional(),
    }).passthrough() // Allow additional fields
);

// ============================================================================
// Discharge & Transfer Schemas
// ============================================================================

export const DischargeDataSchema = z.object({
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

export const TransferDataSchema = z.object({
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

export const CMADataSchema = z.object({
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

export const DailyRecordSchema = z.object({
    date: z.string(),
    beds: z.record(z.string(), PatientDataSchema).default({}),
    discharges: z.array(DischargeDataSchema).default([]),
    transfers: z.array(TransferDataSchema).default([]),
    cma: z.array(CMADataSchema).default([]),
    lastUpdated: z.string().default(() => new Date().toISOString()),
    /** Unix timestamp (ms) for the start of the day, used for security rule validation */
    dateTimestamp: z.number().optional(),
    /** Version of the data structure, used to prevent corruption from old clients */
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
}).passthrough(); // Allow additional fields not defined here

// ============================================================================
// Safe Parsing Utilities
// ============================================================================

/**
 * Safely parse DailyRecord with fallbacks for invalid data
 */
export const safeParseDailyRecord = (data: unknown): z.infer<typeof DailyRecordSchema> | null => {
    const result = DailyRecordSchema.safeParse(data);
    if (result.success) {
        return result.data;
    }
    console.warn('⚠️ DailyRecord validation failed:', result.error.issues);
    return null;
};

/**
 * Parse DailyRecord with partial recovery
 * Returns the data with defaults applied where validation fails
 */
export const parseDailyRecordWithDefaults = (data: unknown, docId: string): z.infer<typeof DailyRecordSchema> => {
    try {
        // First try strict parsing
        return DailyRecordSchema.parse(data);
    } catch {
        // If strict fails, apply defaults and try to recover what's possible
        console.warn('⚠️ Applying defaults to DailyRecord for date:', docId);

        const raw = (typeof data === 'object' && data !== null ? data : {}) as any;

        return {
            date: typeof raw.date === 'string' ? raw.date : docId,
            beds: (typeof raw.beds === 'object' && raw.beds !== null && !Array.isArray(raw.beds)) ? raw.beds : {},
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
            handoffDayChecklist: typeof raw.handoffDayChecklist === 'object' ? raw.handoffDayChecklist : {},
            handoffNightChecklist: typeof raw.handoffNightChecklist === 'object' ? raw.handoffNightChecklist : {},
            handoffNovedadesDayShift: typeof raw.handoffNovedadesDayShift === 'string' ? raw.handoffNovedadesDayShift : '',
            handoffNovedadesNightShift: typeof raw.handoffNovedadesNightShift === 'string' ? raw.handoffNovedadesNightShift : '',
            medicalHandoffNovedades: typeof raw.medicalHandoffNovedades === 'string' ? raw.medicalHandoffNovedades : '',
            // Night shift receiving nurses
            handoffNightReceives: Array.isArray(raw.handoffNightReceives) ? raw.handoffNightReceives : [],
            schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
        };
    }
};
