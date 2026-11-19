// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  validatePhotoFile,
  validateConsentFile,
  BODY_LOCATION_OPTIONS,
} from '@/features/wound-care/domain/woundCareValidation';

// ============================================================================
// Helpers
// ============================================================================

const createMockFile = (name: string, size: number, type: string): File => {
  const buffer = new ArrayBuffer(size);
  return new File([buffer], name, { type });
};

// ============================================================================
// Photo File Validation
// ============================================================================

describe('validatePhotoFile', () => {
  it('accepts JPEG files', () => {
    const file = createMockFile('photo.jpg', 1024, 'image/jpeg');
    expect(validatePhotoFile(file)).toEqual({ valid: true });
  });

  it('accepts PNG files', () => {
    const file = createMockFile('photo.png', 1024, 'image/png');
    expect(validatePhotoFile(file)).toEqual({ valid: true });
  });

  it('accepts WebP files', () => {
    const file = createMockFile('photo.webp', 1024, 'image/webp');
    expect(validatePhotoFile(file)).toEqual({ valid: true });
  });

  it('rejects text/plain files', () => {
    const file = createMockFile('notes.txt', 100, 'text/plain');
    const result = validatePhotoFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects application/pdf files', () => {
    const file = createMockFile('doc.pdf', 100, 'application/pdf');
    const result = validatePhotoFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects files over 15MB', () => {
    const overLimit = 15 * 1024 * 1024 + 1;
    const file = createMockFile('huge.jpg', overLimit, 'image/jpeg');
    const result = validatePhotoFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('demasiado grande');
  });

  it('accepts files exactly at 15MB', () => {
    const exactLimit = 15 * 1024 * 1024;
    const file = createMockFile('big.jpg', exactLimit, 'image/jpeg');
    expect(validatePhotoFile(file)).toEqual({ valid: true });
  });
});

// ============================================================================
// Consent File Validation
// ============================================================================

describe('validateConsentFile', () => {
  it('accepts PDF files', () => {
    const file = createMockFile('consent.pdf', 1024, 'application/pdf');
    expect(validateConsentFile(file)).toEqual({ valid: true });
  });

  it('accepts JPEG image files', () => {
    const file = createMockFile('consent.jpg', 1024, 'image/jpeg');
    expect(validateConsentFile(file)).toEqual({ valid: true });
  });

  it('accepts PNG image files', () => {
    const file = createMockFile('consent.png', 1024, 'image/png');
    expect(validateConsentFile(file)).toEqual({ valid: true });
  });

  it('rejects text/plain files', () => {
    const file = createMockFile('readme.txt', 100, 'text/plain');
    const result = validateConsentFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects application/zip files', () => {
    const file = createMockFile('archive.zip', 100, 'application/zip');
    const result = validateConsentFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects files over 15MB', () => {
    const overLimit = 15 * 1024 * 1024 + 1;
    const file = createMockFile('huge.pdf', overLimit, 'application/pdf');
    const result = validateConsentFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('demasiado grande');
  });
});

// ============================================================================
// Body Location Options
// ============================================================================

describe('BODY_LOCATION_OPTIONS', () => {
  it('has expected number of entries', () => {
    expect(BODY_LOCATION_OPTIONS.length).toBeGreaterThanOrEqual(20);
  });

  it('includes key body locations', () => {
    expect(BODY_LOCATION_OPTIONS).toContain('Sacro');
    expect(BODY_LOCATION_OPTIONS).toContain('Cabeza');
    expect(BODY_LOCATION_OPTIONS).toContain('Otro');
  });

  it('has no duplicate entries', () => {
    const unique = new Set(BODY_LOCATION_OPTIONS);
    expect(unique.size).toBe(BODY_LOCATION_OPTIONS.length);
  });
});
