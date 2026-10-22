const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/(Chrome|CriOS)\//, 'Chrome'],
  [/(Firefox|FxiOS)\//, 'Firefox'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/Windows NT/, 'Windows'],
  [/Android/, 'Android'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X/, 'macOS'],
  [/Linux/, 'Linux'],
];

const firstMatch = (value: string, candidates: Array<[RegExp, string]>): string | undefined =>
  candidates.find(([pattern]) => pattern.test(value))?.[1];

/** Coarse, non-identifying device label: `Chrome · Windows`. */
export const resolveAuditDeviceLabel = (userAgent: string | undefined): string | undefined => {
  if (!userAgent) return undefined;
  const label = [firstMatch(userAgent, BROWSERS), firstMatch(userAgent, SYSTEMS)]
    .filter(Boolean)
    .join(' · ');
  return label || undefined;
};
