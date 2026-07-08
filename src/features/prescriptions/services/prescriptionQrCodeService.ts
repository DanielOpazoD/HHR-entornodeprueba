/**
 * Pure helper that turns the absolute upload URL (e.g.
 * `https://hospitalizadoshhr.netlify.app/recetas/upload`) into a
 * high-contrast PNG data URL the admin can print.
 *
 * Errored to medium ECC so the printed QR survives smudges and
 * lighting changes typical of a hospital ward poster.
 */

import QRCode from 'qrcode';

export const PRESCRIPTIONS_UPLOAD_PATH = '/recetas/upload';

export interface RenderPrescriptionUploadQrParams {
  /** Absolute origin (e.g. `window.location.origin`). */
  origin: string;
  /** Pixel width of the rendered PNG. Default 360. */
  size?: number;
}

export const buildPrescriptionsUploadUrl = (origin: string): string => {
  const trimmedOrigin = origin.replace(/\/+$/, '');
  return `${trimmedOrigin}${PRESCRIPTIONS_UPLOAD_PATH}`;
};

export const renderPrescriptionsUploadQrDataUrl = async ({
  origin,
  size = 360,
}: RenderPrescriptionUploadQrParams): Promise<string> => {
  const url = buildPrescriptionsUploadUrl(origin);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
};
