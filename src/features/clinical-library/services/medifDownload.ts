import type { MedifValues } from '../domain/medifDraft';
import type { MedifPreferences } from '../domain/medifPreferences';
import { createMedifPdf, MEDIF_TEMPLATE_URL, type MedifPdfMode } from './medifPdf';

/** The cache contains only the public blank template, never patient data. */
let templatePromise: Promise<ArrayBuffer> | undefined;
const loadTemplate = (): Promise<ArrayBuffer> => {
  templatePromise ??= fetch(MEDIF_TEMPLATE_URL)
    .then(response => {
      if (!response.ok)
        throw new Error(
          'No se pudo cargar la plantilla MEDIF. Revisa la conexión e inténtalo de nuevo.'
        );
      return response.arrayBuffer();
    })
    .catch((error: unknown) => {
      templatePromise = undefined;
      throw error;
    });
  return templatePromise;
};

export const downloadMedifPdf = async (
  values: MedifValues,
  preferences: MedifPreferences,
  mode: MedifPdfMode,
  signal?: AbortSignal
): Promise<void> => {
  signal?.throwIfAborted();
  const template = await loadTemplate();
  signal?.throwIfAborted();
  const bytes = await createMedifPdf(template, values, preferences, mode);
  signal?.throwIfAborted();
  const { saveAs } = await import('file-saver');
  signal?.throwIfAborted();
  saveAs(
    new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
    `MEDIF-${mode === 'print' ? 'imprimible' : 'editable'}.pdf`
  );
};
