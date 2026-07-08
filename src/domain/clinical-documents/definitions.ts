import type {
  ClinicalDocumentRecord,
  ClinicalDocumentType,
  ClinicalDocumentValidationIssue,
} from '@/domain/clinical-documents/entities';
import { CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION } from '@/domain/clinical-documents/schema';

export type ClinicalDocumentSectionRendererId = 'standard' | 'plan_subsections';

export interface ClinicalDocumentPrintOptions {
  pageSize: 'letter';
  pageMarginMm: number;
  allowBrowserScale: boolean;
  manualPagination: boolean;
  mode: 'inline_browser_print';
}

export interface ClinicalDocumentDefinition {
  documentType: ClinicalDocumentType;
  schemaVersion: number;
  sectionRenderers: Partial<Record<string, ClinicalDocumentSectionRendererId>>;
  sectionNormalizers: Array<
    (sections: ClinicalDocumentRecord['sections']) => ClinicalDocumentRecord['sections']
  >;
  sectionValidators: Array<(record: ClinicalDocumentRecord) => ClinicalDocumentValidationIssue[]>;
  printOptions: ClinicalDocumentPrintOptions;
  resolvePatientFieldLabel?: (
    field: ClinicalDocumentRecord['patientFields'][number]
  ) => string | null;
}

export const CLINICAL_DOCUMENT_DEFAULT_PRINT_OPTIONS: ClinicalDocumentPrintOptions = {
  pageSize: 'letter',
  pageMarginMm: 8,
  allowBrowserScale: true,
  manualPagination: false,
  mode: 'inline_browser_print',
};

const createBaseClinicalDocumentDefinition = (
  documentType: ClinicalDocumentType
): ClinicalDocumentDefinition => ({
  documentType,
  schemaVersion: CURRENT_CLINICAL_DOCUMENT_SCHEMA_VERSION,
  sectionRenderers: {},
  sectionNormalizers: [],
  sectionValidators: [],
  printOptions: CLINICAL_DOCUMENT_DEFAULT_PRINT_OPTIONS,
});

const normalizeEpicrisisSections = (
  sections: ClinicalDocumentRecord['sections']
): ClinicalDocumentRecord['sections'] => {
  const templateDefaults: Record<
    string,
    Pick<ClinicalDocumentRecord['sections'][number], 'title' | 'required' | 'visible'> & {
      order: number;
    }
  > = {
    antecedentes: { title: 'Antecedentes', order: 0, required: true, visible: true },
    'historia-evolucion': {
      title: 'Historia y evolución clínica',
      order: 1,
      required: true,
      visible: true,
    },
    'examenes-complementarios': {
      title: 'Exámenes complementarios',
      order: 2,
      required: false,
      visible: false,
    },
    diagnosticos: { title: 'Diagnósticos de egreso', order: 3, required: false, visible: true },
    plan: { title: 'Indicaciones al alta', order: 4, required: true, visible: true },
  };

  const seen = new Set<string>();
  const normalizedSections = sections.map(section => {
    seen.add(section.id);
    const defaults = templateDefaults[section.id];
    if (!defaults) {
      return { ...section, order: section.order ?? Number.MAX_SAFE_INTEGER };
    }
    const normalizedTitle =
      section.id === 'diagnosticos' && (!section.title || section.title === 'Diagnósticos')
        ? defaults.title
        : section.id === 'plan' && (!section.title || section.title === 'Plan')
          ? defaults.title
          : section.title || defaults.title;
    return {
      ...section,
      title: normalizedTitle,
      required: section.required ?? defaults.required,
      visible: section.visible ?? defaults.visible,
      order: section.order ?? defaults.order,
    };
  });

  Object.entries(templateDefaults).forEach(([sectionId, defaults]) => {
    if (seen.has(sectionId)) return;
    normalizedSections.push({
      id: sectionId,
      title: defaults.title,
      content: '',
      order: defaults.order,
      required: defaults.required,
      visible: defaults.visible,
    });
  });

  return normalizedSections
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return (
        (templateDefaults[left.id]?.order ?? Number.MAX_SAFE_INTEGER) -
        (templateDefaults[right.id]?.order ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map((section, index) => ({ ...section, order: index }));
};

const normalizeEvolutionSections = (
  sections: ClinicalDocumentRecord['sections']
): ClinicalDocumentRecord['sections'] => {
  const templateDefaults: Record<
    string,
    Pick<ClinicalDocumentRecord['sections'][number], 'title' | 'required' | 'visible'> & {
      order: number;
    }
  > = {
    antecedentes: { title: 'Antecedentes', order: 0, required: false, visible: true },
    'historia-evolucion': {
      title: 'Historia y evolución clínica',
      order: 1,
      required: true,
      visible: true,
    },
    diagnosticos: {
      title: 'Diagnósticos actuales',
      order: 2,
      required: false,
      visible: true,
    },
    plan: {
      title: 'Plan',
      order: 3,
      required: true,
      visible: true,
    },
  };

  const seen = new Set<string>();
  const normalizedSections = sections.map(section => {
    seen.add(section.id);
    const defaults = templateDefaults[section.id];
    if (!defaults) {
      return { ...section, order: section.order ?? Number.MAX_SAFE_INTEGER };
    }

    const normalizedTitle =
      section.id === 'diagnosticos' &&
      (!section.title ||
        section.title === 'Diagnósticos' ||
        section.title === 'Diagnósticos de egreso')
        ? defaults.title
        : section.title || defaults.title;

    return {
      ...section,
      title: normalizedTitle,
      required: section.required ?? defaults.required,
      visible: section.visible ?? defaults.visible,
      order: section.order ?? defaults.order,
    };
  });

  Object.entries(templateDefaults).forEach(([sectionId, defaults]) => {
    if (seen.has(sectionId)) return;
    normalizedSections.push({
      id: sectionId,
      title: defaults.title,
      content: '',
      order: defaults.order,
      required: defaults.required,
      visible: defaults.visible,
    });
  });

  return normalizedSections
    .sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return (
        (templateDefaults[left.id]?.order ?? Number.MAX_SAFE_INTEGER) -
        (templateDefaults[right.id]?.order ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map((section, index) => ({ ...section, order: index }));
};

export const CLINICAL_DOCUMENT_DEFINITION_REGISTRY: Record<
  ClinicalDocumentType,
  ClinicalDocumentDefinition
> = {
  epicrisis: {
    ...createBaseClinicalDocumentDefinition('epicrisis'),
    sectionRenderers: { plan: 'plan_subsections' },
    sectionNormalizers: [normalizeEpicrisisSections],
    resolvePatientFieldLabel: field =>
      field.id === 'finf' && (!field.label || field.label === 'Fecha del informe')
        ? 'Fecha de alta'
        : null,
  },
  evolucion: {
    ...createBaseClinicalDocumentDefinition('evolucion'),
    sectionNormalizers: [normalizeEvolutionSections],
  },
  informe_medico: createBaseClinicalDocumentDefinition('informe_medico'),
  epicrisis_traslado: createBaseClinicalDocumentDefinition('epicrisis_traslado'),
  otro: createBaseClinicalDocumentDefinition('otro'),
};

export const getClinicalDocumentDefinition = (
  documentType: ClinicalDocumentType
): ClinicalDocumentDefinition =>
  CLINICAL_DOCUMENT_DEFINITION_REGISTRY[documentType] || CLINICAL_DOCUMENT_DEFINITION_REGISTRY.otro;
