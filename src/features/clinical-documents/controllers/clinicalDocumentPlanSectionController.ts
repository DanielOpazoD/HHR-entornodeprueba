import {
  normalizeClinicalDocumentContentForStorage,
  sanitizeClinicalDocumentHtml,
} from '@/features/clinical-documents/controllers/clinicalDocumentRichTextController';
import {
  appendClinicalDocumentPlanIndicationLine,
  getClinicalDocumentPlanNodeHtml,
  normalizeClinicalDocumentPlanSubsectionContent,
} from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionDom';
import type {
  ClinicalDocumentSection,
  ClinicalDocumentSectionLayout,
} from '@/features/clinical-documents/domain/entities';

export type ClinicalDocumentPlanSubsectionId = 'generales' | 'farmacologicas' | 'control_clinico';

export interface ClinicalDocumentPlanSubsection {
  id: ClinicalDocumentPlanSubsectionId;
  title: string;
}

/** Ordered list of plan subsections (generales, farmacologicas, control clinico). */
export const CLINICAL_DOCUMENT_PLAN_SUBSECTIONS: readonly ClinicalDocumentPlanSubsection[] = [
  { id: 'generales', title: 'Indicaciones generales' },
  { id: 'farmacologicas', title: 'Indicaciones farmacológicas' },
  { id: 'control_clinico', title: 'Control clínico' },
] as const;

const PLAN_TITLE_BY_ID = Object.fromEntries(
  CLINICAL_DOCUMENT_PLAN_SUBSECTIONS.map(subsection => [subsection.id, subsection.title])
) as Record<ClinicalDocumentPlanSubsectionId, string>;

const PLAN_ID_BY_NORMALIZED_TITLE = Object.fromEntries(
  CLINICAL_DOCUMENT_PLAN_SUBSECTIONS.map(subsection => [
    normalizeTitle(subsection.title),
    subsection.id,
  ])
) as Record<string, ClinicalDocumentPlanSubsectionId>;

function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const createEmptyPlanSubsections = (): Record<ClinicalDocumentPlanSubsectionId, string> => ({
  generales: '',
  farmacologicas: '',
  control_clinico: '',
});

const isRecognizedPlanHeading = (element: HTMLElement): ClinicalDocumentPlanSubsectionId | null => {
  const text = normalizeTitle(element.textContent || '');
  return PLAN_ID_BY_NORMALIZED_TITLE[text] || null;
};

const hasRecognizedPlanHeading = (value: string): boolean => {
  const normalized = normalizeClinicalDocumentContentForStorage(value);
  if (!normalized || typeof document === 'undefined') {
    return false;
  }

  const container = document.createElement('div');
  container.innerHTML = normalized;
  return Array.from(container.children).some(child =>
    isRecognizedPlanHeading(child as HTMLElement)
  );
};

/**
 * Parses HTML content of a plan section into per-subsection content by detecting heading markers.
 * @param value - The raw HTML content of the plan section.
 * @returns A record mapping each subsection ID to its HTML content.
 */
export const parseClinicalDocumentPlanSectionContent = (
  value: string
): Record<ClinicalDocumentPlanSubsectionId, string> => {
  const normalized = normalizeClinicalDocumentContentForStorage(value);
  const empty = createEmptyPlanSubsections();

  if (!normalized) {
    return empty;
  }

  if (typeof document === 'undefined') {
    return {
      ...empty,
      generales: normalized,
    };
  }

  const container = document.createElement('div');
  container.innerHTML = normalized;

  let currentSubsectionId: ClinicalDocumentPlanSubsectionId | null = null;
  const subsectionNodes: Record<ClinicalDocumentPlanSubsectionId, string[]> = {
    generales: [],
    farmacologicas: [],
    control_clinico: [],
  };

  Array.from(container.childNodes).forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const maybeHeading = isRecognizedPlanHeading(node as HTMLElement);
      if (maybeHeading) {
        currentSubsectionId = maybeHeading;
        return;
      }
    }

    if (!currentSubsectionId) {
      subsectionNodes.generales.push(getClinicalDocumentPlanNodeHtml(node));
      return;
    }

    subsectionNodes[currentSubsectionId].push(getClinicalDocumentPlanNodeHtml(node));
  });

  const parsed = Object.entries(subsectionNodes).reduce((accumulator, [subsectionId, chunks]) => {
    accumulator[subsectionId as ClinicalDocumentPlanSubsectionId] =
      normalizeClinicalDocumentPlanSubsectionContent(chunks.join('').trim());
    return accumulator;
  }, createEmptyPlanSubsections());

  return parsed;
};

/**
 * Determines whether a plan section should render as "unified" or "structured" layout.
 *
 * Default is `'unified'` (simplified, single editor). Legacy documents that
 * already contain the recognized subsection headings stay as `'structured'` so
 * pre-existing content keeps its 3-section shape. An explicit `section.layout`
 * always wins over both inferences.
 *
 * @param section - Section with content and optional layout override.
 * @returns The resolved layout mode.
 */
export const resolveClinicalDocumentPlanSectionLayout = (
  section: Pick<ClinicalDocumentSection, 'content' | 'layout'>
): ClinicalDocumentSectionLayout =>
  section.layout || (hasRecognizedPlanHeading(section.content) ? 'structured' : 'unified');

const buildHeadingHtml = (title: string): string => `<div><strong>${title}</strong></div>`;

/**
 * Assembles per-subsection HTML content into a single plan section HTML string with headings.
 * @param subsections - A record mapping each subsection ID to its HTML content.
 * @returns The combined HTML, or an empty string if all subsections are empty.
 */
export const buildClinicalDocumentPlanSectionContent = (
  subsections: Record<ClinicalDocumentPlanSubsectionId, string>
): string => {
  const normalized = Object.fromEntries(
    Object.entries(subsections).map(([subsectionId, content]) => [
      subsectionId,
      normalizeClinicalDocumentPlanSubsectionContent(content),
    ])
  ) as Record<ClinicalDocumentPlanSubsectionId, string>;

  const hasSomeContent = Object.values(normalized).some(content => Boolean(content.trim()));
  if (!hasSomeContent) {
    return '';
  }

  const html = CLINICAL_DOCUMENT_PLAN_SUBSECTIONS.map(subsection => {
    const content = normalized[subsection.id];
    return `${buildHeadingHtml(subsection.title)}${content || '<div><br></div>'}`;
  }).join('<div><br></div>');

  return sanitizeClinicalDocumentHtml(html);
};

/**
 * Replaces a single subsection's content within the full plan section HTML and rebuilds the output.
 * @param value - The current full plan section HTML.
 * @param subsectionId - Which subsection to update.
 * @param nextSubsectionContent - The new HTML content for the subsection.
 */
export const updateClinicalDocumentPlanSubsectionContent = (
  value: string,
  subsectionId: ClinicalDocumentPlanSubsectionId,
  nextSubsectionContent: string
): string =>
  buildClinicalDocumentPlanSectionContent({
    ...parseClinicalDocumentPlanSectionContent(value),
    [subsectionId]: nextSubsectionContent,
  });

/**
 * Converts structured plan content (with headings) into unified flat HTML by stripping subsection headings.
 * @param value - The current plan section HTML (may already be unified).
 */
export const buildUnifiedClinicalDocumentPlanSectionContent = (value: string): string => {
  const normalized = normalizeClinicalDocumentContentForStorage(value);
  if (!normalized) {
    return '';
  }

  if (!hasRecognizedPlanHeading(normalized)) {
    return normalized;
  }

  const parsed = parseClinicalDocumentPlanSectionContent(normalized);
  const mergedContent = CLINICAL_DOCUMENT_PLAN_SUBSECTIONS.map(subsection => parsed[subsection.id])
    .filter(content => Boolean(content.trim()))
    .join('<div><br></div>');

  return normalizeClinicalDocumentPlanSubsectionContent(
    sanitizeClinicalDocumentHtml(mergedContent)
  );
};

/**
 * Converts unified plan content into structured format with subsection headings. Already-structured content is re-normalized.
 * @param value - The current plan section HTML (may already be structured).
 */
export const buildStructuredClinicalDocumentPlanSectionContent = (value: string): string => {
  const normalized = normalizeClinicalDocumentContentForStorage(value);
  if (!normalized) {
    return '';
  }

  if (hasRecognizedPlanHeading(normalized)) {
    return buildClinicalDocumentPlanSectionContent(
      parseClinicalDocumentPlanSectionContent(normalized)
    );
  }

  return buildClinicalDocumentPlanSectionContent({
    generales: normalized,
    farmacologicas: '',
    control_clinico: '',
  });
};

/**
 * Appends a plain-text indication line to a specific subsection within the plan section HTML.
 * @param value - The current full plan section HTML.
 * @param subsectionId - The target subsection.
 * @param text - Plain text to append.
 */
export const appendClinicalDocumentPlanSubsectionText = (
  value: string,
  subsectionId: ClinicalDocumentPlanSubsectionId,
  text: string
): string => {
  const parsed = parseClinicalDocumentPlanSectionContent(value);
  return buildClinicalDocumentPlanSectionContent({
    ...parsed,
    [subsectionId]: appendClinicalDocumentPlanIndicationLine(parsed[subsectionId], text),
  });
};

/**
 * Appends a plain-text indication to the simplified one-box plan layout without
 * rebuilding the three structured subsection headings.
 */
export const appendClinicalDocumentUnifiedPlanText = (value: string, text: string): string =>
  appendClinicalDocumentPlanIndicationLine(
    buildUnifiedClinicalDocumentPlanSectionContent(value),
    text
  );

/** Returns the display title for a plan subsection (e.g. "Indicaciones generales"). */
export const getClinicalDocumentPlanSubsectionTitle = (
  subsectionId: ClinicalDocumentPlanSubsectionId
): string => PLAN_TITLE_BY_ID[subsectionId];
