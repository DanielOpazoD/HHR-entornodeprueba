export type LegacyCompatibilityMode = 'explicit_bridge' | 'disabled';

const normalizeLegacyMode = (value: string | undefined): LegacyCompatibilityMode => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (normalized === 'disabled') {
    return 'disabled';
  }

  if (normalized === 'explicit_bridge') {
    return 'explicit_bridge';
  }

  return 'disabled';
};

export const getLegacyCompatibilityMode = (): LegacyCompatibilityMode =>
  normalizeLegacyMode(import.meta.env.VITE_LEGACY_COMPATIBILITY_MODE);

export const isLegacyBridgeEnabled = (): boolean =>
  getLegacyCompatibilityMode() === 'explicit_bridge';

// Legacy compatibility remains a controlled read/normalize boundary for
// records arriving from older Firebase clients. It must not re-enter the
// main persistence path as an implicit fallback.
export const shouldUseLegacyCompatibilityInHotPath = (): boolean => false;
