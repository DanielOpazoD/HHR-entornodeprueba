/**
 * Extracts positioned text items (x/y) from a base64 PDF, reusing HHR's existing pdfjs runtime
 * (`loadPdfJsTextRuntime`, which already resolves the worker). Unlike `extractPdfTextFromBuffer`
 * — which flattens to line strings — this keeps each fragment's x/y so `parseInvasiveDevices`
 * can rebuild the DISPOSITIVOS INVASIVOS table by column. Browser-only (pdfjs worker).
 */

import { loadPdfJsTextRuntime } from '@/services/pdf/pdfJsTextRuntime';
import type { DeviceTextItem } from './parseInvasiveDevices';

const base64ToBytes = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), char => char.charCodeAt(0));

export const extractDeviceTextItems = async (base64: string): Promise<DeviceTextItem[]> => {
  if (!base64) return [];
  const pdfjs = await loadPdfJsTextRuntime();
  const document = await pdfjs.getDocument({
    data: base64ToBytes(base64),
    useWorkerFetch: false,
    isEvalSupported: false,
  }).promise;

  const items: DeviceTextItem[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'str' in item &&
        'transform' in item &&
        typeof item.str === 'string'
      ) {
        const transform = item.transform as number[] | Float32Array;
        items.push({ x: Number(transform[4] ?? 0), y: Number(transform[5] ?? 0), str: item.str });
      }
    }
  }
  return items;
};
