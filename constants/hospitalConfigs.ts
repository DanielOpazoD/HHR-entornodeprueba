/**
 * Hospital Salvador Configuration
 * Questions and templates for generating transfer documents
 */

import { HospitalConfig } from '@/types/transferDocuments';

export const hospitalSalvadorConfig: HospitalConfig = {
    id: 'hospital-salvador',
    name: 'Hospital del Salvador',
    code: 'HSalvador',

    emails: {
        to: [
            'ugchds@hsalvador.cl',
            'traslados@hsalvador.cl'
        ],
        cc: [
            'andrea.saldana@saludoriente.cl',
            'mariaisabel.marros@saludoriente.cl',
            'carolina.jara@saludoriente.cl',
            'traslados@hospitalhangaroa.cl',
            'gestion.camas@saludoriente.cl'
        ]
    },

    questions: [
        // ========================================
        // Tapa de Traslado (No extra questions needed)
        // ========================================

        // ========================================
        // Encuesta COVID
        // ========================================
        {
            id: 'contactoCovid',
            label: '¿Contacto con persona COVID+ en últimas 48hrs?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'encuesta-covid'
        },
        {
            id: 'sintomasCovid',
            label: '¿Presenta síntomas COVID?',
            type: 'multiselect',
            required: false,
            options: ['Tos', 'Fiebre', 'Ausencia de gusto/olfato', 'Cefalea', 'Ninguno'],
            group: 'encuesta-covid'
        },

        // ========================================
        // Solicitud de Ambulancia
        // ========================================
        {
            id: 'medicoTratante',
            label: 'Médico Tratante',
            type: 'text',
            required: true,
            placeholder: 'Dr. ...',
            group: 'solicitud-ambulancia'
        },
        {
            id: 'enfermeraResponsable',
            label: 'Enfermera Responsable',
            type: 'text',
            required: true,
            group: 'solicitud-ambulancia'
        },
        {
            id: 'posicionTraslado',
            label: 'Posición de traslado',
            type: 'select',
            required: true,
            options: ['Acostado', 'Sentado'],
            defaultValue: 'Acostado',
            group: 'solicitud-ambulancia'
        },
        {
            id: 'requiereAcompanante',
            label: '¿Paciente acompañado?',
            type: 'boolean',
            required: true,
            defaultValue: true,
            group: 'solicitud-ambulancia'
        },
        {
            id: 'requiereOxigeno',
            label: '¿Requiere oxígeno?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'solicitud-ambulancia'
        },
        {
            id: 'otrasCondiciones',
            label: 'Otras condiciones especiales',
            type: 'textarea',
            required: false,
            placeholder: 'Ej: Monitor cardíaco, bomba de infusión...',
            group: 'solicitud-ambulancia'
        },
        {
            id: 'lineaAerea',
            label: 'Línea Aérea',
            type: 'text',
            required: true,
            placeholder: 'Ej: LATAM, Aerocardal...',
            group: 'solicitud-ambulancia'
        },
        {
            id: 'numeroVuelo',
            label: 'Número de Vuelo',
            type: 'text',
            required: true,
            placeholder: 'Ej: LA 844',
            group: 'solicitud-ambulancia'
        },
        {
            id: 'horaDespegue',
            label: 'Hora de Despegue (IPC)',
            type: 'time',
            required: true,
            group: 'solicitud-ambulancia'
        },
        {
            id: 'horaArribo',
            label: 'Hora de Arribo (STGO)',
            type: 'time',
            required: true,
            group: 'solicitud-ambulancia'
        },
        {
            id: 'nombreAcompanante',
            label: 'Nombre del Acompañante',
            type: 'text',
            required: false,
            group: 'solicitud-ambulancia',
            showIf: { questionId: 'requiereAcompanante', value: true }
        },
        {
            id: 'telefonoAcompanante',
            label: 'Teléfono de Contacto',
            type: 'phone',
            required: false,
            placeholder: '+56 9 ...',
            group: 'solicitud-ambulancia',
            showIf: { questionId: 'requiereAcompanante', value: true }
        },

        // ========================================
        // Formulario IAAS
        // ========================================
        {
            id: 'precaucionesAdicionales',
            label: '¿Precauciones adicionales a las estándar?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'formulario-iaas'
        },
        {
            id: 'tipoPrecauciones',
            label: 'Tipo de precauciones',
            type: 'multiselect',
            required: false,
            options: ['Contacto', 'Gotas', 'Aéreo'],
            group: 'formulario-iaas',
            showIf: { questionId: 'precaucionesAdicionales', value: true }
        },
        {
            id: 'ambienteProtegido',
            label: '¿Requiere ambiente protegido?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'formulario-iaas'
        },
        {
            id: 'estudioMicrobiologico',
            label: '¿Se realizó estudio microbiológico?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'formulario-iaas'
        },
        {
            id: 'resultadosMicrobiologicos',
            label: 'Resultados (Fecha / Tipo muestra / Agente)',
            type: 'textarea',
            required: false,
            placeholder: 'Ej: 01/01/2025 / Hemocultivo / E. coli',
            group: 'formulario-iaas',
            showIf: { questionId: 'estudioMicrobiologico', value: true }
        },
        {
            id: 'carbapenemasas',
            label: '¿Bacilos Gram negativos productores de carbapenemasas?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'formulario-iaas'
        },
        {
            id: 'enterococcusVR',
            label: '¿Enterococcus resistente a vancomicina?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'formulario-iaas'
        },
        {
            id: 'estudioPortacion',
            label: '¿Se realizó estudio de portación?',
            type: 'boolean',
            required: true,
            defaultValue: false,
            group: 'formulario-iaas'
        },
        {
            id: 'unidadesHospitalizacion',
            label: 'Unidad de Hospitalización (UPC/Básica)',
            type: 'multiselect',
            required: true,
            options: ['Cama básica', 'UPC (UCI/UTI)'],
            group: 'formulario-iaas'
        }
    ],

    templates: [
        {
            id: 'tapa-traslado',
            name: 'Tapa de Traslado',
            format: 'docx',
            enabled: true,
            requiredQuestions: []
        },
        {
            id: 'encuesta-covid',
            name: 'Encuesta COVID',
            format: 'docx',
            enabled: true,
            requiredQuestions: ['contactoCovid', 'sintomasCovid']
        },
        {
            id: 'solicitud-ambulancia',
            name: 'Solicitud de Ambulancia',
            format: 'docx',
            enabled: true,
            requiredQuestions: [
                'medicoTratante', 'enfermeraResponsable', 'posicionTraslado',
                'requiereAcompanante', 'requiereOxigeno', 'lineaAerea',
                'numeroVuelo', 'horaDespegue', 'horaArribo'
            ]
        },
        {
            id: 'solicitud-cama-hds',
            name: 'Solicitud de Cama HDS',
            format: 'docx',
            enabled: true,
            requiredQuestions: ['medicoTratante', 'enfermeraResponsable']
        },
        {
            id: 'formulario-iaas',
            name: 'Formulario IAAS',
            format: 'xlsx',
            enabled: true,
            requiredQuestions: [
                'precaucionesAdicionales', 'ambienteProtegido',
                'estudioMicrobiologico', 'carbapenemasas', 'enterococcusVR',
                'estudioPortacion', 'unidadesHospitalizacion'
            ]
        }
    ]
};

/**
 * Get all available hospital configurations
 */
export const getHospitalConfigs = (): HospitalConfig[] => {
    return [hospitalSalvadorConfig];
};

/**
 * Get a hospital config by ID
 */
export const getHospitalConfigById = (id: string): HospitalConfig | undefined => {
    return getHospitalConfigs().find(h => h.id === id);
};

/**
 * Question groups mapping to templates
 */
export const questionGroups = {
    'tapa-traslado': { label: 'Tapa de Traslado', icon: 'FileText' },
    'encuesta-covid': { label: 'Encuesta COVID', icon: 'Virus' },
    'solicitud-cama-hds': { label: 'Solicitud de Cama HDS', icon: 'Bed' },
    'solicitud-ambulancia': { label: 'Solicitud de Ambulancia', icon: 'Ambulance' },
    'formulario-iaas': { label: 'Formulario IAAS', icon: 'Shield' }
};

