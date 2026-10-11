// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { assertStorageAvailable } from '@/services/backup/storageAvailability';

describe('storageAvailability', () => {
  it('does not throw when storage instance exists', () => {
    expect(() => assertStorageAvailable({}, 'PdfStorage', 'uploadPdf')).not.toThrow();
  });

  it('throws explicit error when storage is missing', () => {
    expect(() => assertStorageAvailable(null, 'PdfStorage', 'uploadPdf')).toThrow(
      '[PdfStorage] Firebase Storage not initialized for uploadPdf'
    );
  });
});
