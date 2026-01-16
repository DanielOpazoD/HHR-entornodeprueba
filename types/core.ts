/**
 * Core Type Definitions
 * Main data types for the hospital census application
 */

export enum BedType {
    UTI = 'UTI',
    MEDIA = 'MEDIA',
}

export enum Specialty {
    MEDICINA = 'Med Interna',
    CIRUGIA = 'Cirugía',
    TRAUMATOLOGIA = 'Traumatología',
    GINECOBSTETRICIA = 'Ginecobstetricia',
    PSIQUIATRIA = 'Psiquiatría',
    PEDIATRIA = 'Pediatría',
    OTRO = 'Otro',
    EMPTY = ''
}

export enum PatientStatus {
    GRAVE = 'Grave',
    DE_CUIDADO = 'De cuidado',
    ESTABLE = 'Estable',
    EMPTY = ''
}

export type ShiftType = 'day' | 'night';

// Fixed list of 18 beds + Extras
export interface BedDefinition {
    id: string;
    name: string;
    type: BedType;
    isCuna: boolean; // Default configuration
    isExtra?: boolean;
}

export interface CudyrScore {
    // Dependencia (6 items)
    changeClothes: number;
    mobilization: number;
    feeding: number;
    elimination: number;
    psychosocial: number;
    surveillance: number;

    // Riesgo (8 items)
    vitalSigns: number;
    fluidBalance: number;
    oxygenTherapy: number;
    airway: number;
    proInterventions: number;
    skinCare: number;
    pharmacology: number;
    invasiveElements: number;
}

/**
 * Clinical Event - Tracks procedures, surgeries, cultures, etc.
 * Persists across days while patient is hospitalized
 */
export interface ClinicalEvent {
    id: string;           // UUID
    name: string;         // Event name (free text)
    date: string;         // ISO date string
    note?: string;        // Optional additional note
    createdAt: string;    // ISO timestamp when created
}

/**
 * Basic FHIR Resource structure for Core-CL compatibility
 */
export interface FhirResource {
    resourceType: string;
    id?: string;
    meta?: {
        profile?: string[];
    };
    [key: string]: any; // Allow full FHIR properties
}

export interface PatientData {
    bedId: string;
    isBlocked: boolean;
    blockedReason?: string;

    // Dynamic Furniture Configuration
    bedMode: 'Cama' | 'Cuna'; // Defines if the physical spot is set up as a Bed or a Crib (Census relevant)
    hasCompanionCrib: boolean; // Defines if there is an EXTRA crib for a healthy RN (Resource relevant)

    // Nested Patient Data for Clinical Crib (Sick Newborn sharing room with Mother)
    clinicalCrib?: PatientData;

    patientName: string;
    rut: string;
    documentType?: 'RUT' | 'Pasaporte'; // Switcher
    age: string;
    birthDate?: string;
    biologicalSex?: 'Masculino' | 'Femenino' | 'Indeterminado';
    insurance?: 'Fonasa' | 'Isapre' | 'Particular';

    // Demographics Update
    admissionOrigin?: 'CAE' | 'APS' | 'Urgencias' | 'Pabellón' | 'Otro';
    admissionOriginDetails?: string; // For 'Otro'
    origin?: 'Residente' | 'Turista Nacional' | 'Turista Extranjero'; // Now labeled "Condición de permanencia"

    isRapanui?: boolean;
    pathology: string;
    snomedCode?: string; // Standardized SNOMED CT code
    cie10Code?: string; // Standardized CIE-10 code
    diagnosisComments?: string; // New field for sub-diagnosis details (e.g. surgical dates)
    specialty: Specialty;
    status: PatientStatus;
    admissionDate: string;
    admissionTime?: string;
    hasWristband: boolean;
    devices: string[];
    deviceDetails?: DeviceDetails; // Dates/notas for tracked devices (CUP, CVC, VMI, VVP)
    surgicalComplication: boolean;
    isUPC: boolean;
    location?: string;

    // CUDYR Data
    cudyr?: CudyrScore;

    // Handoff / Nursing Evolution (Shift-based)
    handoffNote?: string; // Legacy/fallback
    handoffNoteDayShift?: string; // Turno Largo (8:00-20:00)
    handoffNoteNightShift?: string; // Turno Noche (20:00-08:00)

    // Medical Handoff
    medicalHandoffNote?: string;

    // Clinical Events (procedures, surgeries, cultures, etc.)
    clinicalEvents?: ClinicalEvent[];

    // Obstetric delivery tracking (Ginecobstetricia only)
    deliveryRoute?: 'Vaginal' | 'Cesárea';
    deliveryDate?: string; // ISO date string

    // HL7 FHIR Core-CL Resource (Optional for dual-mode sync)
    fhir_resource?: FhirResource;
}

/**
 * Device date tracking for infection surveillance (IAAS)
 * Tracks installation/removal dates for invasive devices
 */
export interface DeviceInfo {
    installationDate?: string;  // Date device was installed
    removalDate?: string;       // Date device was removed (optional)
    note?: string;              // Free text note for the device
}

export interface DeviceDetails {
    CUP?: DeviceInfo;  // Sonda Foley
    CVC?: DeviceInfo;  // Catéter Venoso Central
    VMI?: DeviceInfo;  // Ventilación Mecánica Invasiva
    'VVP#1'?: DeviceInfo; // Vía Venosa Periférica #1
    'VVP#2'?: DeviceInfo; // Vía Venosa Periférica #2
    'VVP#3'?: DeviceInfo; // Vía Venosa Periférica #3
}

// Extracted type for reuse
export type DischargeType = 'Domicilio (Habitual)' | 'Voluntaria' | 'Fuga' | 'Otra';

export interface DischargeData {
    id: string;
    bedName: string;
    bedId: string; // Needed for undo
    bedType: string;
    patientName: string;
    rut: string;
    diagnosis: string;
    time: string;
    status: 'Vivo' | 'Fallecido';
    dischargeType?: DischargeType; // Sub-classification for 'Vivo'
    dischargeTypeOther?: string; // Description if 'Otra'
    age?: string;
    insurance?: string;
    origin?: string;
    isRapanui?: boolean;
    originalData?: PatientData; // Snapshot for Undo
    isNested?: boolean; // Identifies if it was a clinical crib
}

export interface TransferData {
    id: string;
    bedName: string;
    bedId: string; // Needed for undo
    bedType: string;
    patientName: string;
    rut: string;
    diagnosis: string;
    time: string;
    evacuationMethod: string;
    receivingCenter: string;
    receivingCenterOther?: string;
    transferEscort?: string;
    age?: string;
    insurance?: string;
    origin?: string;
    isRapanui?: boolean;
    originalData?: PatientData; // Snapshot for Undo
    isNested?: boolean; // Identifies if it was a clinical crib
}

export interface CMAData {
    id: string;
    bedName: string; // Generic location or identifier
    patientName: string;
    rut: string;
    age: string;
    diagnosis: string;
    specialty: string;
    interventionType: 'Cirugía Mayor Ambulatoria' | 'Procedimiento Médico Ambulatorio'; // New field
    enteredBy?: string; // Optional: user who added the record
    timestamp?: string; // Optional: creation time
}

export interface DailyRecord {
    date: string;
    beds: Record<string, PatientData>;
    discharges: DischargeData[];
    transfers: TransferData[];
    cma: CMAData[]; // Cirugía Mayor Ambulatoria
    lastUpdated: string;
    /** Unix timestamp (ms) for the start of the day, used for security rule validation */
    dateTimestamp?: number;
    /** Version of the data structure, used to prevent corruption from old clients */
    schemaVersion?: number;
    /** @deprecated Use nursesDayShift / nursesNightShift instead. Maintained for legacy sync support. */
    nurses: string[];
    /** @deprecated Use nursesDayShift[0]. Maintained for legacy sync support. */
    nurseName?: string;
    nursesDayShift?: string[]; // Turno Largo nurses
    nursesNightShift?: string[]; // Turno Noche nurses
    tensDayShift?: string[]; // Turno Largo TENS (max 3)
    tensNightShift?: string[]; // Turno Noche TENS (max 3)
    activeExtraBeds: string[];

    // ===== Handoff Checklist - Day Shift (Turno Largo) =====
    handoffDayChecklist?: {
        escalaBraden?: boolean;
        escalaRiesgoCaidas?: boolean;
        escalaRiesgoLPP?: boolean;
    };

    // ===== Handoff Checklist - Night Shift (Turno Noche) =====
    handoffNightChecklist?: {
        estadistica?: boolean;
        categorizacionCudyr?: boolean;
        encuestaUTI?: boolean;
        encuestaMedias?: boolean;
        conteoMedicamento?: boolean;
        // conteoMedicamentoProximaFecha?: string; // Legacy/Unused if moved? Leaving for safety or removing?
        // User wants "No Controlados" with date.
        // Let's keep existing and add new.
        conteoNoControlados?: boolean;
        conteoNoControladosProximaFecha?: string;
    };

    // ===== Handoff Novedades (Free text section) =====
    handoffNovedadesDayShift?: string;
    handoffNovedadesNightShift?: string;

    // ===== Nurse Handoff Identification =====
    // Deprecated: handoffDayDelivers, handoffDayReceives, handoffNightDelivers removed. 
    // Uses nursesDayShift/nursesNightShift directly (Single Source of Truth).
    handoffNightReceives?: string[]; // Nurses who receive night shift (Next day's night or unique)

    // ===== Medical Handoff Novedades =====
    medicalHandoffNovedades?: string; // Free text novedades for medical handoff

    // ===== Medical Handoff Signature =====
    medicalHandoffDoctor?: string; // Doctor delivering the shift
    medicalHandoffSentAt?: string; // Timestamp when the share link was clicked
    medicalSignature?: {
        doctorName: string;
        signedAt: string; // ISO timestamp
        userAgent?: string; // Optional device info
    };
}

export interface Statistics {
    occupiedBeds: number; // Adult beds occupied by patients (Census)
    occupiedCribs: number; // Nested Cribs ONLY (Internal counter)
    clinicalCribsCount: number; // Main (Cuna Mode) + Nested Cribs (For Resource Display)
    companionCribs: number; // Cribs used by healthy RN (associated to mother)
    totalCribsUsed: number; // Total physical cribs (Occupied by Patient + Companion)
    totalHospitalized: number; // occupiedBeds + occupiedCribs
    blockedBeds: number;
    serviceCapacity: number; // 18 - blocked
    availableCapacity: number;
}
