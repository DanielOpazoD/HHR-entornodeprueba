/**
 * Demo Data Generator
 * Generates realistic demo data for testing and demonstration purposes.
 * Supports multi-day generation with patient continuity.
 */

import { DailyRecord, PatientData, PatientStatus, Specialty, DischargeData, TransferData, ClinicalEvent } from '../../types';
import { BEDS, DEVICE_OPTIONS, VVP_DEVICE_KEYS } from '../../constants';
import { createEmptyPatient } from '../factories/patientFactory';
import { getTimeRoundedToStep } from '../../utils';

// ============================================================================
// Clinical Profiles - Realistic diagnosis-specialty-status mappings
// ============================================================================

const CLINICAL_PROFILES: Record<Specialty, Array<{ dx: string, status: PatientStatus, upc: boolean, avgStay: number, cie10?: { code: string, desc: string } | string, events?: string[] }>> = {
    [Specialty.MEDICINA]: [
        { dx: 'Neumonía Adquirida en Comunidad', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 7 },
        { dx: 'Insuficiencia Cardíaca Descompensada', status: PatientStatus.GRAVE, upc: true, avgStay: 10 },
        { dx: 'EPOC Exacerbado', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 6 },
        { dx: 'Crisis Hipertensiva', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 3 },
        { dx: 'Sepsis Origen Urinario', status: PatientStatus.GRAVE, upc: true, avgStay: 12 },
        { dx: 'Descompensación Diabética', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 4 },
    ],
    [Specialty.CIRUGIA]: [
        { dx: 'Apendicitis Aguda Operada', status: PatientStatus.ESTABLE, upc: false, avgStay: 3 },
        { dx: 'Colecistitis Aguda Operada', status: PatientStatus.ESTABLE, upc: false, avgStay: 2 },
        { dx: 'Abdomen Agudo en Estudio', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 5 },
        { dx: 'Fractura de Cadera Operada', status: PatientStatus.ESTABLE, upc: false, avgStay: 8 },
        { dx: 'Politraumatismo', status: PatientStatus.GRAVE, upc: true, avgStay: 14 },
    ],
    [Specialty.GINECOBSTETRICIA]: [
        { dx: 'Post Parto Vaginal', status: PatientStatus.ESTABLE, upc: false, avgStay: 2 },
        { dx: 'Post Cesárea', status: PatientStatus.ESTABLE, upc: false, avgStay: 3 },
        { dx: 'Preeclampsia Severa', status: PatientStatus.GRAVE, upc: true, avgStay: 7 },
        { dx: 'Embarazo Alto Riesgo', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 10 },
    ],
    [Specialty.PEDIATRIA]: [
        { dx: 'Bronquiolitis', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 4 },
        { dx: 'Síndrome Diarreico Agudo', status: PatientStatus.ESTABLE, upc: false, avgStay: 2 },
        { dx: 'SDR Neonatal', status: PatientStatus.GRAVE, upc: true, avgStay: 10 },
        { dx: 'Neumonía Pediátrica', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 5 },
    ],
    [Specialty.TRAUMATOLOGIA]: [
        { dx: 'Fractura de Fémur', status: PatientStatus.ESTABLE, upc: false, avgStay: 6, cie10: { code: 'S72.9', desc: 'Fractura del fémur, parte no especificada' } },
        { dx: 'Fractura de Tibia Operada', status: PatientStatus.ESTABLE, upc: false, avgStay: 4, cie10: { code: 'S82.2', desc: 'Fractura de la diáfisis de la tibia' } },
        { dx: 'Trauma Craneoencefálico Severo', status: PatientStatus.GRAVE, upc: true, avgStay: 15, cie10: { code: 'S06.9', desc: 'Traumatismo intracraneal, no especificado' } },
        { dx: 'Fractura de fémur proximal', status: PatientStatus.DE_CUIDADO, upc: false, avgStay: 7, cie10: 'S72.0', events: ['Cirugía de osteosíntesis', 'Evaluación Kinesiológica'] },
        { dx: 'Artroplastia de cadera', status: PatientStatus.ESTABLE, upc: false, avgStay: 5, cie10: 'Z96.6', events: ['Cirugía de reemplazo articular', 'Protocolo analgesia'] },
    ],
    [Specialty.PSIQUIATRIA]: [],
    [Specialty.OTRO]: [],
    [Specialty.EMPTY]: [],
};

// Helper to get CIE10 description from code
const getCIE10Description = (cie10: string | { code: string, desc: string }): string => {
    if (typeof cie10 === 'string') {
        // In a real app, you'd look this up from a dictionary
        switch (cie10) {
            case 'S72.0': return 'Fractura del cuello del fémur';
            case 'Z96.6': return 'Presencia de implantes ortopédicos articulares';
            default: return '';
        }
    }
    return cie10.desc;
};

// Demo data constants
const LOCAL_DEMO_NAMES = [
    "Juan Pérez", "María González", "Carlos Tapia", "Ana Tuki", "José Paoa",
    "Elena Huke", "Roberto Nahoe", "Carmen Pakarati", "Luis Tepano", "Sofia Hotu",
    "Pedro Pont", "Marta Tuki", "Lucas Atan", "Isabel Haoa", "Nicolas Pate",
    "Diego Rapu", "Valentina Hey", "Matías Araki", "Camila Teao", "Sebastián Make",
    "Francisca Riroroko", "Gabriel Hotus", "Antonia Veri", "Tomás Hereveri", "Javiera Pakomio"
];

const LOCAL_DEMO_RUTS = [
    "12.345.678-9", "9.876.543-2", "15.432.198-K", "18.900.123-4", "7.654.321-0",
    "10.234.567-8", "11.111.111-1", "20.300.400-5", "16.543.210-3", "14.789.012-6",
    "19.876.543-1", "8.765.432-9", "17.654.321-K", "13.210.987-4", "21.098.765-2"
];

const RECEIVING_CENTERS = ["Hospital Carlos Van Buren", "Hospital El Pino", "Hospital Sótero del Río", "Hospital San Juan de Dios", "Hospital UC"];
const EVACUATION_METHODS = ["FACH", "Aerocardal", "LATAM", "Militar"];

const UTI_BEDS = ['R1', 'R2', 'R3', 'R4'];
const usedNames = new Set<string>();
const ALL_DEVICE_OPTIONS = [...VVP_DEVICE_KEYS, ...DEVICE_OPTIONS];

// ============================================================================
// Helper Functions
// ============================================================================

const randomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

const getUniqueName = (): string => {
    let attempts = 0;
    while (attempts < 50) {
        const name = randomItem(LOCAL_DEMO_NAMES);
        if (!usedNames.has(name)) {
            usedNames.add(name);
            return name;
        }
        attempts++;
    }
    // If all names used, create a variant
    const baseName = randomItem(LOCAL_DEMO_NAMES);
    const suffix = Math.floor(Math.random() * 100);
    return `${baseName} ${suffix}`;
};

const resetUsedNames = () => {
    usedNames.clear();
};

const generateCudyrScores = (isUPC: boolean, hasDevices: boolean) => ({
    changeClothes: Math.floor(Math.random() * 4),
    mobilization: Math.floor(Math.random() * 4),
    feeding: Math.floor(Math.random() * 4),
    elimination: Math.floor(Math.random() * 4),
    psychosocial: Math.floor(Math.random() * 4),
    surveillance: Math.floor(Math.random() * 4),
    vitalSigns: Math.floor(Math.random() * 4),
    fluidBalance: Math.floor(Math.random() * 4),
    oxygenTherapy: isUPC ? Math.floor(Math.random() * 2) + 2 : Math.floor(Math.random() * 4),
    airway: isUPC ? Math.floor(Math.random() * 2) + 2 : Math.floor(Math.random() * 4),
    proInterventions: Math.floor(Math.random() * 4),
    skinCare: Math.floor(Math.random() * 4),
    pharmacology: Math.floor(Math.random() * 4),
    invasiveElements: hasDevices ? Math.floor(Math.random() * 2) + 1 : Math.floor(Math.random() * 4)
});

const addDays = (dateStr: string, days: number): string => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
};

const getDaysInMonth = (year: number, month: number): number => {
    return new Date(year, month + 1, 0).getDate();
};

// ============================================================================
// Single Day Generator (for initial day)
// ============================================================================

const generateNewPatient = (bedId: string, admissionDate: string): PatientData => {
    const patient = createEmptyPatient(bedId);
    const bedDef = BEDS.find(b => b.id === bedId);

    patient.patientName = getUniqueName();
    patient.rut = randomItem(LOCAL_DEMO_RUTS);
    patient.documentType = 'RUT';
    patient.biologicalSex = randomItem(['Masculino', 'Femenino']);
    patient.insurance = randomItem(['Fonasa', 'Isapre']);
    patient.admissionDate = admissionDate;
    patient.admissionOrigin = randomItem(['Urgencias', 'CAE', 'APS']);
    patient.origin = randomItem(['Residente', 'Turista Nacional']);
    patient.hasWristband = true;
    patient.isRapanui = Math.random() > 0.5;

    // UTI beds -> UPC patients
    if (UTI_BEDS.includes(bedId)) {
        const specialty = randomItem([Specialty.MEDICINA, Specialty.CIRUGIA]);
        const graveProfiles = CLINICAL_PROFILES[specialty].filter(p => p.upc);
        const profile = randomItem(graveProfiles) || CLINICAL_PROFILES[specialty][0];

        patient.specialty = specialty;
        patient.pathology = profile.dx;
        patient.status = PatientStatus.GRAVE;
        patient.isUPC = true;
        patient.age = (Math.floor(Math.random() * 60) + 20) + "a";
        patient.devices = [randomItem(['VVP#1', 'CVC', 'CUP', 'VMI'])];
        patient.cie10Code = typeof profile.cie10 === 'string' ? profile.cie10 : profile.cie10?.code;
        patient.cie10Description = getCIE10Description(profile.cie10 || '');
        patient.clinicalEvents = profile.events?.map(name => ({
            id: crypto.randomUUID(),
            name,
            date: admissionDate,
            createdAt: new Date().toISOString()
        })) || [];
    }
    // NEO beds -> Neonates
    else if (bedId.startsWith('NEO')) {
        patient.bedMode = 'Cuna';
        patient.age = Math.floor(Math.random() * 20) + "d";
        patient.specialty = Specialty.PEDIATRIA;
        const neoProfiles = CLINICAL_PROFILES[Specialty.PEDIATRIA];
        const profile = randomItem(neoProfiles);
        patient.pathology = profile.dx;
        patient.status = profile.status;
        patient.isUPC = profile.upc;
        patient.cie10Code = typeof profile.cie10 === 'string' ? profile.cie10 : profile.cie10?.code;
        patient.cie10Description = getCIE10Description(profile.cie10 || '');
        patient.clinicalEvents = profile.events?.map(name => ({
            id: crypto.randomUUID(),
            name,
            date: admissionDate,
            createdAt: new Date().toISOString()
        })) || [];
    }
    // Obstetric patients
    else if (patient.biologicalSex === 'Femenino' && Math.random() > 0.7) {
        patient.specialty = Specialty.GINECOBSTETRICIA;
        const obsProfiles = CLINICAL_PROFILES[Specialty.GINECOBSTETRICIA];
        const profile = randomItem(obsProfiles);
        patient.pathology = profile.dx;
        patient.status = profile.status;
        patient.isUPC = profile.upc;
        patient.age = (Math.floor(Math.random() * 20) + 18) + "a";
        patient.cie10Code = typeof profile.cie10 === 'string' ? profile.cie10 : profile.cie10?.code;
        patient.cie10Description = getCIE10Description(profile.cie10 || '');
        patient.clinicalEvents = profile.events?.map(name => ({
            id: crypto.randomUUID(),
            name,
            date: admissionDate,
            createdAt: new Date().toISOString()
        })) || [];

        // Maybe add a baby
        if (Math.random() > 0.6 && profile.dx.includes('Parto')) {
            patient.hasCompanionCrib = true;
        } else if (Math.random() > 0.7) {
            patient.clinicalCrib = createEmptyPatient(bedId);
            patient.clinicalCrib.bedMode = 'Cuna';
            patient.clinicalCrib.patientName = "RN de " + patient.patientName;
            patient.clinicalCrib.age = "2d";
            patient.clinicalCrib.specialty = Specialty.PEDIATRIA;
            patient.clinicalCrib.pathology = "SDR Recién Nacido";
            patient.clinicalCrib.rut = "Recién Nacido";
            patient.clinicalCrib.status = PatientStatus.DE_CUIDADO;
            patient.clinicalCrib.biologicalSex = randomItem(['Masculino', 'Femenino']);
        }
    }
    // Regular beds -> Mixed specialties
    else {
        const specialty = randomItem([Specialty.MEDICINA, Specialty.CIRUGIA, Specialty.TRAUMATOLOGIA]);
        const profiles = CLINICAL_PROFILES[specialty];
        const profile = randomItem(profiles);

        patient.specialty = specialty;
        patient.pathology = profile.dx;
        patient.status = profile.status;
        patient.isUPC = profile.upc;
        patient.age = (Math.floor(Math.random() * 70) + 10) + "a";

        // Add sample CIE-10 and clinical events
        patient.cie10Code = typeof profile.cie10 === 'string' ? profile.cie10 : profile.cie10?.code;
        patient.cie10Description = getCIE10Description(profile.cie10 || '');
        patient.clinicalEvents = profile.events?.map(name => ({
            id: crypto.randomUUID(),
            name,
            date: admissionDate,
            createdAt: new Date().toISOString()
        })) || [];
    }

    // Random devices for non-UPC
    if (!patient.isUPC && Math.random() > 0.7) {
        patient.devices = [randomItem(ALL_DEVICE_OPTIONS)];
    }

    // Generate CUDYR scores
    patient.cudyr = generateCudyrScores(patient.isUPC, patient.devices.length > 0);

    return patient;
};

// ============================================================================
// Initial Day Generator
// ============================================================================

/**
 * Generates a completely new daily record from scratch.
 * 
 * Simulation Parameters:
 * - 85% Bed Occupancy (randomly assigned).
 * - 5% Blocked Bed probability per bed.
 * - Random assignments of patient demographics, diagnostics, and specialties based on bed type (UTI, Medicine, Pediatrics, etc.).
 * 
 * @param date - The date string (YYYY-MM-DD) for the record.
 * @returns A fully populated DailyRecord object.
 */
export const generateDemoRecord = (date: string): DailyRecord => {
    resetUsedNames();
    const demoBeds: Record<string, PatientData> = {};

    BEDS.forEach(bed => {
        let pData = createEmptyPatient(bed.id);
        const rand = Math.random();

        if (!bed.isExtra) {
            if (rand < 0.05) {
                // 5% blocked
                pData.isBlocked = true;
                pData.blockedReason = randomItem(["Mantención", "Aislamiento", "Falla Eléctrica"]);
            } else if (rand < 0.90) {
                // 85% occupied
                pData = generateNewPatient(bed.id, date);
            }
        }

        demoBeds[bed.id] = pData;
    });

    return {
        date,
        beds: demoBeds,
        discharges: [],
        transfers: [],
        lastUpdated: new Date().toISOString(),
        nurses: ["Enfermero Demo 1", "Enfermero Demo 2"],
        activeExtraBeds: [],
        cma: []
    };
};

// ============================================================================
// Multi-Day Generator with Continuity
// ============================================================================

/**
 * Evolve a record from the previous day to the next day.
 * Simulates discharges, transfers, new admissions, and status changes.
 */
const evolveDayRecord = (previousRecord: DailyRecord, newDate: string): DailyRecord => {
    const newBeds: Record<string, PatientData> = {};
    const discharges: DischargeData[] = [];
    const transfers: TransferData[] = [];

    Object.entries(previousRecord.beds).forEach(([bedId, patient]) => {
        const bedDef = BEDS.find(b => b.id === bedId);

        // Copy patient to new day
        let newPatient = JSON.parse(JSON.stringify(patient)) as PatientData;

        if (patient.patientName && !patient.isBlocked) {
            // Calculate days hospitalized
            const admissionDate = patient.admissionDate || previousRecord.date;
            const daysHospitalized = Math.ceil(
                (new Date(newDate).getTime() - new Date(admissionDate).getTime()) / (1000 * 60 * 60 * 24)
            );

            // Get expected stay from profile
            const specialty = patient.specialty || Specialty.MEDICINA;
            const profiles = CLINICAL_PROFILES[specialty] || [];
            const matchingProfile = profiles.find(p => p.dx === patient.pathology);
            const avgStay = matchingProfile?.avgStay || 5;

            // Probability of discharge/transfer increases with time
            const dischargeChance = Math.min(0.3, daysHospitalized / avgStay * 0.15);
            const transferChance = patient.isUPC ? 0.1 : 0.02; // UPC patients more likely to transfer

            const rand = Math.random();

            if (rand < dischargeChance) {
                // Discharge this patient
                discharges.push({
                    id: crypto.randomUUID(),
                    bedName: bedDef?.name || bedId,
                    bedId: bedId,
                    bedType: bedDef?.type || '',
                    patientName: patient.patientName,
                    rut: patient.rut,
                    diagnosis: patient.pathology,
                    time: getTimeRoundedToStep(),
                    status: Math.random() > 0.02 ? 'Vivo' : 'Fallecido',
                    age: patient.age,
                    insurance: patient.insurance,
                    origin: patient.origin,
                    isRapanui: patient.isRapanui,
                    originalData: patient,
                    isNested: false
                });

                // Clinical crib also discharged
                if (patient.clinicalCrib?.patientName) {
                    discharges.push({
                        id: crypto.randomUUID(),
                        bedName: (bedDef?.name || bedId) + " (Cuna)",
                        bedId: bedId,
                        bedType: 'Cuna',
                        patientName: patient.clinicalCrib.patientName,
                        rut: patient.clinicalCrib.rut,
                        diagnosis: patient.clinicalCrib.pathology,
                        time: getTimeRoundedToStep(),
                        status: 'Vivo',
                        age: patient.clinicalCrib.age,
                        insurance: patient.insurance,
                        origin: patient.origin,
                        isRapanui: patient.isRapanui,
                        originalData: patient.clinicalCrib,
                        isNested: true
                    });
                }

                // Empty the bed
                newPatient = createEmptyPatient(bedId);
                newPatient.location = patient.location;

            } else if (rand < dischargeChance + transferChance) {
                // Transfer this patient
                transfers.push({
                    id: crypto.randomUUID(),
                    bedName: bedDef?.name || bedId,
                    bedId: bedId,
                    bedType: bedDef?.type || '',
                    patientName: patient.patientName,
                    rut: patient.rut,
                    diagnosis: patient.pathology,
                    time: getTimeRoundedToStep(),
                    evacuationMethod: randomItem(EVACUATION_METHODS),
                    receivingCenter: randomItem(RECEIVING_CENTERS),
                    receivingCenterOther: '',
                    age: patient.age,
                    insurance: patient.insurance,
                    origin: patient.origin,
                    isRapanui: patient.isRapanui,
                    originalData: patient,
                    isNested: false
                });

                // Empty the bed
                newPatient = createEmptyPatient(bedId);
                newPatient.location = patient.location;

            } else {
                // Patient stays - maybe status change
                if (Math.random() < 0.1) {
                    // Status improvement
                    if (patient.status === PatientStatus.GRAVE) {
                        newPatient.status = PatientStatus.DE_CUIDADO;
                    } else if (patient.status === PatientStatus.DE_CUIDADO) {
                        newPatient.status = PatientStatus.ESTABLE;
                    }
                }
            }
        }

        newBeds[bedId] = newPatient;
    });

    // Fill empty beds with new admissions (2-4 per day)
    const emptyBeds = Object.entries(newBeds)
        .filter(([id, p]) => !p.patientName && !p.isBlocked && !BEDS.find(b => b.id === id)?.isExtra)
        .map(([id]) => id);

    const newAdmissions = Math.min(emptyBeds.length, Math.floor(Math.random() * 3) + 2);
    for (let i = 0; i < newAdmissions; i++) {
        const bedId = emptyBeds[i];
        newBeds[bedId] = generateNewPatient(bedId, newDate);
    }

    return {
        date: newDate,
        beds: newBeds,
        discharges,
        transfers,
        lastUpdated: new Date().toISOString(),
        nurses: previousRecord.nurses,
        activeExtraBeds: previousRecord.activeExtraBeds,
        cma: []
    };
};

// ============================================================================
// Period Generators
// ============================================================================

/**
 * Generate demo data for a single day
 */
export const generateDemoForDay = (date: string): DailyRecord[] => {
    resetUsedNames();
    return [generateDemoRecord(date)];
};

/**
 * Generate demo data for a week (7 days) with continuity
 */
export const generateDemoForWeek = (startDate: string): DailyRecord[] => {
    resetUsedNames();
    const records: DailyRecord[] = [];

    // Generate first day
    let currentRecord = generateDemoRecord(startDate);
    records.push(currentRecord);

    // Evolve for 6 more days
    for (let i = 1; i < 7; i++) {
        const nextDate = addDays(startDate, i);
        currentRecord = evolveDayRecord(currentRecord, nextDate);
        records.push(currentRecord);
    }

    return records;
};

/**
 * Generate demo data for an entire month with continuity
 */
export const generateDemoForMonth = (year: number, month: number): DailyRecord[] => {
    resetUsedNames();
    const records: DailyRecord[] = [];
    const daysInMonth = getDaysInMonth(year, month);
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;

    // Generate first day
    let currentRecord = generateDemoRecord(startDate);
    records.push(currentRecord);

    // Evolve for rest of month
    for (let day = 2; day <= daysInMonth; day++) {
        const nextDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        currentRecord = evolveDayRecord(currentRecord, nextDate);
        records.push(currentRecord);
    }

    return records;
};
