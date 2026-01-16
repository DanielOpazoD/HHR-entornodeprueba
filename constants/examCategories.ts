/**
 * Exam Categories for Laboratory Request Form
 * Based on Hospital Hanga Roa's official laboratory request form.
 */

export interface ExamCategory {
    id: string;
    name: string;
    tube?: string;
    exams: string[];
}

export const EXAM_CATEGORIES: ExamCategory[] = [
    {
        id: 'bioquimica',
        name: 'BIOQUIMICA',
        tube: 'TUBO AMARILLO – ROJO',
        exams: [
            'GLICEMIA', 'P.T.G.O', 'UREMIA', 'CREATININA', 'FOSFATASA ALCALINA',
            'GOT – GPT', 'GGT', 'AMILASA', 'PROTEINA TOTAL', 'ALBUMINA',
            'BILIRRUBINA DIRECTA Y TOTAL', 'LDH', 'LIPASA', 'URICEMIA',
            'COLESTEROL', 'COLESTEROL HDL', 'TRIGLICERIDOS', 'CK', 'CK-MB',
            'GASES ARTERIALES (JERINGA HEPARINIZADA)', 'GASES VENOSOS (JERINGA HEPARINIZADA)',
            'FERRITINA', 'ELECTROLITOS PLASMATICOS', 'LACTATO'
        ]
    },
    {
        id: 'hematologia',
        name: 'HEMATOLOGIA',
        tube: 'TUBO LILA',
        exams: [
            'HEMOGRAMA', 'VHS', 'RCTO.LEUCOCITOS', 'RCTO. PLAQUETAS',
            'HEMATOCRITO', 'HEMOGLOBINA', 'HEMOGLOBINA GLICOSILADA',
            'GRUPO SANGUINEO ABO-RH'
        ]
    },
    {
        id: 'coagulacion',
        name: 'COAGULACION',
        tube: 'TUBO CELESTE',
        exams: [
            'PROTROMBINA/ INR', 'TTPK', 'TIEMPO DE SANGRÍA',
            'FIBRINOGENO', 'DIMERO - D'
        ]
    },
    {
        id: 'hormonas',
        name: 'HORMONAS',
        tube: 'TUBO AMARILLO – ROJO',
        exams: [
            'H. TIROESTIMULANTE (TSH)', 'TIROXINA LIBRE (T4L)',
            'TROPONINA', 'ANT. PROST-ESPECIF. (PSA)', 'SUB. UND Β- HCG'
        ]
    },
    {
        id: 'microbiologicos',
        name: 'MICROBIOLOGICOS',
        exams: [
            'UROCULTIVO', 'HEMOCULTIVO', 'COPROCULTIVO',
            'MYCOPLASMA-UREAPLASMA', 'FLUJO VAGINAL', 'TINCION BAAR',
            'SECRECIONES'
        ]
    },
    {
        id: 'orina',
        name: 'ORINA',
        exams: [
            'SEDIMENTO URINARIO', 'ORINA COMPLETA', 'TEST DE EMBARAZO'
        ]
    },
    {
        id: 'parasitologia',
        name: 'PARASITOLOGIA',
        exams: [
            'COPROPARASITARO', 'TEST DE GRAHAM', 'ACAROTEST'
        ]
    },
    {
        id: 'virologia',
        name: 'VIROLOGIA',
        exams: [
            'ROTAVIRUS', 'ADENOVIRUS', 'SARS-COV-2',
            'DENGUE/ZIKA/CHIKUNGUNYA'
        ]
    },
    {
        id: 'inmunologia',
        name: 'INMUNOLOGIA/SEROLOGÍA',
        tube: 'TUBO AMARILLO – ROJO',
        exams: [
            'PROTEINA C REACTIVA', 'FACTOR REUMATOIDEO', 'R.P.R.',
            'IGM DENGUE'
        ]
    },
    {
        id: 'otros',
        name: 'OTROS',
        exams: [
            'TEST DE WEBER (HEMORRAGIAS OCULTAS)',
            'CITOLOGICO (MICROTUBO LILA 0.5CC)',
            'FISICO QUIMICO (JERINGA)',
            'LEUCOCITOS FECALES',
            'MICOLOGICO DIRECTO'
        ]
    }
];

/** Procedencia options for the form */
export const PROCEDENCIA_OPTIONS = [
    'Infantil', 'Adulto', 'Maternal', 'Policlínico', 'Hospitalización', 'Urgencia'
] as const;

/** FONASA levels */
export const FONASA_LEVELS = ['A', 'B', 'C', 'D'] as const;
