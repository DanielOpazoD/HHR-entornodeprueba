import { loadPdfJsTextRuntime } from '@/services/pdf/pdfJsTextRuntime';

export type PdfTextNormalizer = (text: string) => string;

export const normalizePdfText = (text: string): string =>
  text
    .replace(/\u00a2/g, 'ó')
    .replace(/\u00b0/g, 'o')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

type PdfTransform = number[] | Float32Array;

const transformPoint = (
  itemTransform: PdfTransform,
  viewportTransform?: PdfTransform
): { x: number; y: number } => {
  if (!viewportTransform) {
    return { x: itemTransform[4] ?? 0, y: itemTransform[5] ?? 0 };
  }
  return {
    x:
      (viewportTransform[0] ?? 0) * (itemTransform[4] ?? 0) +
      (viewportTransform[2] ?? 0) * (itemTransform[5] ?? 0) +
      (viewportTransform[4] ?? 0),
    y:
      (viewportTransform[1] ?? 0) * (itemTransform[4] ?? 0) +
      (viewportTransform[3] ?? 0) * (itemTransform[5] ?? 0) +
      (viewportTransform[5] ?? 0),
  };
};

/**
 * Rebuilds visual lines from PDF.js text items.
 *
 * PDF.js exposes item coordinates in the PDF's original coordinate system. Applying the page
 * viewport is essential for reports declared with `/Rotate 90`: without it, cells from the same
 * column are incorrectly joined as one line and tabular rows cannot be parsed.
 */
export const groupPdfTextItemsIntoLines = (
  items: unknown[],
  viewportTransform?: PdfTransform
): string[] => {
  const positioned = items
    .filter(
      (item): item is { str: string; transform: number[] | Float32Array } =>
        typeof item === 'object' &&
        item !== null &&
        'str' in item &&
        typeof item.str === 'string' &&
        item.str.trim().length > 0 &&
        'transform' in item &&
        (Array.isArray(item.transform) || item.transform instanceof Float32Array)
    )
    .map(item => ({ text: item.str.trim(), ...transformPoint(item.transform, viewportTransform) }))
    .sort((a, b) =>
      Math.abs(b.y - a.y) > 1 ? (viewportTransform ? a.y - b.y : b.y - a.y) : a.x - b.x
    );

  const lines: Array<{ y: number; tokens: Array<{ text: string; x: number }> }> = [];

  for (const item of positioned) {
    const existing = lines.find(line => Math.abs(line.y - item.y) <= 2);
    if (existing) {
      existing.tokens.push({ text: item.text, x: item.x });
    } else {
      lines.push({ y: item.y, tokens: [{ text: item.text, x: item.x }] });
    }
  }

  return lines
    .sort((a, b) => (viewportTransform ? a.y - b.y : b.y - a.y))
    .map(line =>
      line.tokens
        .sort((a, b) => a.x - b.x)
        .map(token => token.text)
        .join(' ')
        // Normalize a detached label colon ("RUN : 123") without splitting clock values.
        .replace(/\s+:\s*/g, ': ')
        .replace(/[ ]{2,}/g, ' ')
        .trim()
    )
    .filter(Boolean);
};

export const extractPdfTextFromBuffer = async (
  buffer: ArrayBuffer,
  normalizeText: PdfTextNormalizer = normalizePdfText
): Promise<string> => {
  const pdfjs = await loadPdfJsTextRuntime();

  const document = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const lines = groupPdfTextItemsIntoLines(
      textContent.items.filter(item => typeof item === 'object' && item !== null),
      viewport.transform
    );
    pages.push(lines.join('\n'));
  }

  return normalizeText(pages.join('\n\n'));
};
