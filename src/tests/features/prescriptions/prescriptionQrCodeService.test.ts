import { describe, expect, it, vi } from 'vitest';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async (text: string) => `data:image/png;base64,STUB::${text}`),
  },
}));

import {
  PRESCRIPTIONS_UPLOAD_PATH,
  buildPrescriptionsUploadUrl,
  renderPrescriptionsUploadQrDataUrl,
} from '@/features/prescriptions/services/prescriptionQrCodeService';

describe('buildPrescriptionsUploadUrl', () => {
  it('appends the canonical upload path to the provided origin', () => {
    expect(buildPrescriptionsUploadUrl('https://hospitalizadoshhr.netlify.app')).toBe(
      `https://hospitalizadoshhr.netlify.app${PRESCRIPTIONS_UPLOAD_PATH}`
    );
  });

  it('strips trailing slashes from the origin so the path joins cleanly', () => {
    expect(buildPrescriptionsUploadUrl('https://example.com//')).toBe(
      `https://example.com${PRESCRIPTIONS_UPLOAD_PATH}`
    );
  });
});

describe('renderPrescriptionsUploadQrDataUrl', () => {
  it('renders a PNG data URL pointing at the upload route', async () => {
    const dataUrl = await renderPrescriptionsUploadQrDataUrl({
      origin: 'https://hospitalizadoshhr.netlify.app',
      size: 256,
    });
    expect(dataUrl).toContain(`https://hospitalizadoshhr.netlify.app${PRESCRIPTIONS_UPLOAD_PATH}`);
  });

  it('uses default size when none is provided', async () => {
    const result = await renderPrescriptionsUploadQrDataUrl({
      origin: 'https://localhost:3000',
    });
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
  });
});
