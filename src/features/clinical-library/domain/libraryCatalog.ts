import type {
  LibraryCategory,
  LibraryCategoryId,
  LibraryDocumentEntry,
  LibraryEntry,
  LibraryToolEntry,
} from './libraryCatalogTypes';

export const LIBRARY_CATEGORIES: ReadonlyArray<LibraryCategory> = [
  { id: 'forms', label: 'Formularios', emptyTitle: 'Sin formularios para esta búsqueda' },
  { id: 'protocols', label: 'Protocolos', emptyTitle: 'Aún no hay protocolos publicados' },
  { id: 'infographics', label: 'Infografías', emptyTitle: 'Aún no hay infografías publicadas' },
  { id: 'tools', label: 'Herramientas', emptyTitle: 'Sin herramientas para esta búsqueda' },
];

export const findLibraryCategory = (id: LibraryCategoryId): LibraryCategory =>
  LIBRARY_CATEGORIES.find(category => category.id === id) ?? LIBRARY_CATEGORIES[0];

const HHR_SOURCE = 'Hospital Hanga Roa · Hospitalizados';

const DOCUMENTS: ReadonlyArray<LibraryDocumentEntry> = [
  {
    kind: 'document',
    id: 'solicitud-laboratorio-policlinico',
    category: 'forms',
    title: 'Solicitud de exámenes de laboratorio',
    description:
      'Formulario de policlínico con el listado de exámenes por área: bioquímica, hematología, coagulación, microbiología, orina y hormonas.',
    format: 'pdf',
    url: '/docs/biblioteca/solicitud-laboratorio-policlinico.pdf',
    pages: 1,
    sizeKb: 143,
    keywords: ['laboratorio', 'exámenes', 'solicitud', 'policlínico', 'hemograma', 'orina'],
    source: HHR_SOURCE,
  },
  {
    kind: 'document',
    id: 'solicitud-imagenologia',
    category: 'forms',
    title: 'Solicitud de examen de imagenología',
    description: 'Orden de radiología, ecografía o tomografía para completar a mano e imprimir.',
    format: 'pdf',
    url: '/docs/solicitud-imagen.pdf',
    pages: 1,
    sizeKb: 192,
    keywords: [
      'imagenología',
      'radiología',
      'ecografía',
      'tomografía',
      'TAC',
      'solicitud',
      'MMRAD',
    ],
    source: HHR_SOURCE,
  },
  {
    kind: 'document',
    id: 'encuesta-contraste',
    category: 'forms',
    title: 'Encuesta de seguridad para medio de contraste',
    description:
      'Cuestionario previo a tomografía con contraste: alergias, función renal, metformina y embarazo.',
    format: 'pdf',
    url: '/docs/encuesta-contraste.pdf',
    pages: 1,
    sizeKb: 219,
    keywords: ['contraste', 'TAC', 'tomografía', 'encuesta', 'alergia', 'yodo'],
    source: HHR_SOURCE,
  },
  {
    kind: 'document',
    id: 'consentimiento-informado',
    category: 'forms',
    title: 'Consentimiento informado general',
    description:
      'Formato institucional para procedimientos: identificación, procedimiento, declaración y firmas.',
    format: 'pdf',
    url: '/docs/consentimiento.pdf',
    pages: 1,
    sizeKb: 97,
    keywords: ['consentimiento', 'procedimiento', 'firma', 'apoderado'],
    source: HHR_SOURCE,
  },
  {
    kind: 'document',
    id: 'solicitud-tuberculosis',
    category: 'forms',
    title: 'Solicitud de investigación bacteriológica de tuberculosis',
    description: 'Formulario del Programa Nacional de Control y Eliminación de la Tuberculosis.',
    format: 'pdf',
    url: '/docs/biblioteca/solicitud-tuberculosis-minsal.pdf',
    pages: 1,
    sizeKb: 49,
    keywords: ['tuberculosis', 'TBC', 'baciloscopía', 'esputo', 'MINSAL', 'solicitud'],
    source: 'Ministerio de Salud',
  },
  {
    kind: 'document',
    id: 'solicitud-vdrl-mha-tp',
    category: 'forms',
    title: 'Solicitud de VDRL y MHA-TP',
    description:
      'Solicitud de serología de sífilis del Laboratorio Clínico del Hospital del Salvador.',
    format: 'pdf',
    url: '/docs/biblioteca/solicitud-vdrl-mha-tp-hds.pdf',
    pages: 1,
    sizeKb: 402,
    keywords: ['VDRL', 'MHA-TP', 'sífilis', 'serología', 'Hospital del Salvador', 'solicitud'],
    source: 'Hospital del Salvador',
  },
  {
    kind: 'document',
    id: 'solicitud-serologia-hepatitis-chagas',
    category: 'forms',
    title: 'Solicitud de serología: hepatitis B y C, Chagas, HTLV',
    description:
      'Solicitud de la sección serología del Laboratorio Clínico del Hospital del Salvador.',
    format: 'pdf',
    url: '/docs/biblioteca/solicitud-serologia-hepatitis-chagas-hds.pdf',
    pages: 1,
    sizeKb: 86,
    keywords: [
      'hepatitis',
      'HBsAg',
      'VHC',
      'Chagas',
      'HTLV',
      'toxoplasma',
      'serología',
      'Hospital del Salvador',
    ],
    source: 'Hospital del Salvador',
  },
  {
    kind: 'document',
    id: 'medif-latam',
    category: 'forms',
    title: 'MEDIF: formulario médico para viaje aéreo (LATAM)',
    description: 'Formulario estándar de información médica para el traslado aéreo de pacientes.',
    format: 'pdf',
    url: '/docs/biblioteca/medif-latam.pdf',
    pages: 3,
    sizeKb: 455,
    keywords: ['MEDIF', 'LATAM', 'vuelo', 'traslado aéreo', 'avión', 'aerolínea'],
    source: 'LATAM Airlines',
  },
  {
    kind: 'document',
    id: 'planilla-monitorizacion-ventilatoria',
    category: 'forms',
    title: 'Planilla de monitorización ventilatoria (VMI)',
    description:
      'Hoja de registro de parámetros de ventilación mecánica invasiva, con columna horaria y GSA.',
    format: 'docx',
    url: '/docs/biblioteca/planilla-monitorizacion-ventilatoria-vmi.docx',
    sizeKb: 24,
    keywords: ['ventilación mecánica', 'VMI', 'monitorización', 'gases', 'GSA', 'UCI', 'word'],
    source: HHR_SOURCE,
  },
  {
    kind: 'document',
    id: 'informe-traslado-hospital-salvador',
    category: 'forms',
    title: 'Informe de traslado al Hospital del Salvador',
    description: 'Formato de antecedentes personales y clínicos para solicitar traslado.',
    format: 'docx',
    url: '/docs/biblioteca/informe-traslado-hospital-salvador.docx',
    sizeKb: 34,
    keywords: ['traslado', 'Hospital del Salvador', 'informe', 'derivación', 'word'],
    source: HHR_SOURCE,
  },
];

const TOOLS: ReadonlyArray<LibraryToolEntry> = [
  {
    kind: 'tool',
    id: 'infusion',
    category: 'tools',
    title: 'Dilución y velocidad de infusión',
    description:
      'Convierte una dosis (mcg/kg/min, mg/h, UI/h…) en mL/h y viceversa, con diluciones de referencia de vasoactivos, sedantes y otras infusiones.',
    keywords: [
      'dilución',
      'infusión',
      'bomba',
      'mL/h',
      'noradrenalina',
      'adrenalina',
      'dopamina',
      'dobutamina',
      'vasoactivos',
      'sedación',
      'UCI',
    ],
  },
  {
    kind: 'tool',
    id: 'dosing',
    category: 'tools',
    title: 'Cálculo de dosis y antropometría',
    description:
      'Dosis por kilo (peso real, ideal o ajustado), IMC, superficie corporal y clearance de creatinina (Cockcroft-Gault).',
    keywords: [
      'dosis',
      'peso ideal',
      'peso ajustado',
      'IMC',
      'superficie corporal',
      'clearance',
      'creatinina',
      'UCI',
    ],
  },
  {
    kind: 'tool',
    id: 'scores',
    category: 'tools',
    title: 'Scores clínicos',
    description:
      'qSOFA, Glasgow, CURB-65, Wells (TEP), Padua y CHA₂DS₂-VASc con interpretación y referencia bibliográfica.',
    keywords: [
      'score',
      'escala',
      'qSOFA',
      'Glasgow',
      'CURB-65',
      'Wells',
      'Padua',
      'CHA2DS2-VASc',
      'sepsis',
      'neumonía',
      'TEP',
    ],
  },
];

export const CLINICAL_LIBRARY_ENTRIES: ReadonlyArray<LibraryEntry> = [...DOCUMENTS, ...TOOLS];

export const findLibraryEntry = (id: string): LibraryEntry | undefined =>
  CLINICAL_LIBRARY_ENTRIES.find(entry => entry.id === id);
