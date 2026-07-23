import { describe, expect, it } from 'vitest';
import {
  appendJscanifyDocumentPages,
  computeSha384Integrity,
  getDocumentOutputDimensions,
  JSCANIFY_POC_METADATA,
  mapScannerLuminance,
} from '@/features/document-scanner/services/jscanifyDocumentScannerService';
import {
  DOCUMENT_TONE_PROFILES,
  mapDocumentLuminance,
} from '@/features/document-scanner/services/documentFilterProfiles';

describe('JScanify document scanner proof of concept', () => {
  it('normalizes portrait pages to an A4-like output ratio', () => {
    expect(getDocumentOutputDimensions(1200, 1800)).toEqual({ width: 1556, height: 2200 });
  });

  it('preserves landscape orientation in the normalized output', () => {
    expect(getDocumentOutputDimensions(1800, 1200)).toEqual({ width: 2200, height: 1556 });
  });

  it('pins the open-source processing runtimes', () => {
    expect(JSCANIFY_POC_METADATA).toEqual({
      jscanifyVersion: '1.4.2',
      openCvVersion: '4.7.0-release.1',
      license: 'MIT',
      delivery: 'verified-worker-cdn-poc',
    });
  });

  it('verifies SHA-384 without Web Crypto for local HTTP on mobile Safari', async () => {
    const bytes = new TextEncoder().encode('abc');
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    await expect(computeSha384Integrity(buffer, null)).resolves.toBe(
      'sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn'
    );
  });

  it('maps a gray paper background to white while preserving dark text', () => {
    expect(mapScannerLuminance(205, 45, 210)).toBeGreaterThan(245);
    expect(mapScannerLuminance(205, 45, 210)).toBeLessThan(255);
    expect(mapScannerLuminance(55, 45, 210)).toBeLessThan(50);
  });

  it('keeps midtones instead of turning the scan into high-contrast black and white', () => {
    const middleGray = mapScannerLuminance(135, 35, 225);

    expect(middleGray).toBeGreaterThan(120);
    expect(middleGray).toBeLessThan(220);
  });

  it('keeps the scanner, grayscale and color profiles visibly distinct', () => {
    const scannerPaper = mapDocumentLuminance(210, 30, 'scanner');
    const grayscalePaper = mapDocumentLuminance(210, 30, 'grayscale');
    const colorPaper = mapDocumentLuminance(210, 30, 'color');

    expect(scannerPaper).toBeGreaterThan(grayscalePaper);
    expect(grayscalePaper).toBeGreaterThan(colorPaper);
    expect(DOCUMENT_TONE_PROFILES.scanner.saturation).toBeLessThan(
      DOCUMENT_TONE_PROFILES.color.saturation
    );
  });

  it('rejects additional photos before processing when the PDF already has 12 pages', async () => {
    const session = {
      pages: Array.from({ length: 12 }, () => ({ filterMode: 'scanner' })),
    } as Parameters<typeof appendJscanifyDocumentPages>[0];

    await expect(
      appendJscanifyDocumentPages(session, [
        new File(['page'], 'pagina-13.jpg', { type: 'image/jpeg' }),
      ])
    ).rejects.toThrow('máximo de 12 páginas');
    expect(session.pages).toHaveLength(12);
  });
});
