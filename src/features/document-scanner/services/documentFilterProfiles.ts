export type DocumentScanFilterMode = 'color' | 'scanner' | 'grayscale' | 'original';

interface DocumentToneProfile {
  readonly gamma: number;
  readonly paperLift: number;
  readonly shadowBlend: number;
  readonly saturation: number;
}

export const DOCUMENT_TONE_PROFILES: Readonly<
  Record<Exclude<DocumentScanFilterMode, 'original'>, DocumentToneProfile>
> = Object.freeze({
  scanner: { gamma: 1.01, paperLift: 0.58, shadowBlend: 0.9, saturation: 0.32 },
  grayscale: { gamma: 0.96, paperLift: 0.34, shadowBlend: 0.78, saturation: 0 },
  color: { gamma: 0.94, paperLift: 0.25, shadowBlend: 0.7, saturation: 1.05 },
});

const clamp = (value: number, minimum = 0, maximum = 255): number =>
  Math.min(maximum, Math.max(minimum, value));

const smoothstep = (minimum: number, maximum: number, value: number): number => {
  const normalized = clamp((value - minimum) / Math.max(1, maximum - minimum), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
};

export const mapDocumentLuminance = (
  luminance: number,
  blackPoint: number,
  mode: Exclude<DocumentScanFilterMode, 'original'>
): number => {
  const profile = DOCUMENT_TONE_PROFILES[mode];
  const normalized = clamp((luminance - blackPoint) / Math.max(80, 252 - blackPoint), 0, 1);
  const curved = 255 * normalized ** profile.gamma;
  const lifted =
    curved +
    (255 - curved) * profile.paperLift * smoothstep(150, 248, luminance) * profile.shadowBlend;
  return Math.round(lifted >= 253 ? 255 : clamp(lifted));
};

export const mapScannerLuminance = (
  luminance: number,
  blackPoint: number,
  whitePoint: number
): number => {
  const normalized = clamp((luminance - blackPoint) / Math.max(32, whitePoint - blackPoint), 0, 1);
  const curved = 255 * normalized ** DOCUMENT_TONE_PROFILES.scanner.gamma;
  const lifted = curved + (255 - curved) * 0.42 * smoothstep(0.62, 0.98, normalized);
  return Math.round(lifted >= 253 ? 255 : clamp(lifted));
};
