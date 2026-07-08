/**
 * Clinical Document Empty Section Template Controller
 *
 * Resolves a starter list scaffold (numbered or bulleted) for sections whose
 * canonical content shape is a list (e.g., "Diagnósticos de egreso" → numbered;
 * "Indicaciones al alta" and its 3 plan subsections → bulleted).
 *
 * The scaffold is shown only as an editor placeholder when the underlying
 * section content is empty — it is NOT persisted until the user actually types,
 * so untouched sections still serialize as `''` in storage.
 */

const NUMBERED_LIST_TEMPLATE = '<ol><li><br></li></ol>';
const BULLET_LIST_TEMPLATE = '<ul><li><br></li></ul>';

const SECTION_ID_TEMPLATES: Record<string, string> = {
  diagnosticos: NUMBERED_LIST_TEMPLATE,
  plan: BULLET_LIST_TEMPLATE,
};

const SUBSECTION_ID_PREFIXES: Record<string, string> = {
  'plan:': BULLET_LIST_TEMPLATE,
};

/**
 * Returns the empty-state HTML scaffold for a section editor, or `null` when
 * the section has no list-default behavior.
 *
 * @param sectionId - Section identifier as passed to the rich-text editor
 *   (e.g. `'diagnosticos'`, `'plan'`, `'plan:generales'`).
 */
export const resolveClinicalDocumentEmptySectionTemplate = (sectionId: string): string | null => {
  const directMatch = SECTION_ID_TEMPLATES[sectionId];
  if (directMatch) return directMatch;

  for (const [prefix, template] of Object.entries(SUBSECTION_ID_PREFIXES)) {
    if (sectionId.startsWith(prefix)) return template;
  }

  return null;
};

export type ClinicalDocumentMandatoryListType = 'ol' | 'ul';

/**
 * Returns the list tag (`'ol'` or `'ul'`) that the section editor MUST keep
 * wrapping its content. Used to restore the list scaffold if the user deletes
 * the wrapper element (e.g. via Backspace at start, or Select-All + Delete).
 *
 * Returns `null` for sections without a mandatory list shape.
 */
export const resolveClinicalDocumentMandatoryListType = (
  sectionId: string
): ClinicalDocumentMandatoryListType | null => {
  const template = resolveClinicalDocumentEmptySectionTemplate(sectionId);
  if (!template) return null;
  if (template.startsWith('<ol')) return 'ol';
  if (template.startsWith('<ul')) return 'ul';
  return null;
};
