/**
 * Age display helpers shared between the census UI and exporters.
 *
 * Convention: plain numbers are years and get an "a" suffix ("35" → "35a");
 * values already carrying a unit ("10d", "5m", "3a") are kept as-is.
 */
export function formatAge(age?: string): string {
  if (!age) return '';
  const trimmed = age.trim();
  if (/^\d+$/.test(trimmed)) return `${trimmed}a`;
  if (/^\d+\s*a$/i.test(trimmed)) return trimmed.replace(/\s+/g, '');
  return trimmed;
}
