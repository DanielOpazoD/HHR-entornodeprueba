import type { RayenExtensionHealthReport, RayenSourceHealth } from './extensionHealthBridge';

/** Absolute expiry wins over a cached readiness flag or countdown. */
export const normalizeSourceExpiry = (
  source: RayenSourceHealth,
  label: string,
  now: number,
  checkedAt: number
): RayenSourceHealth => {
  const remaining =
    typeof source.expiresAt === 'number' && Number.isFinite(source.expiresAt)
      ? (source.expiresAt - now) / 1000
      : typeof source.remainingSeconds === 'number' && Number.isFinite(source.remainingSeconds)
        ? source.remainingSeconds - Math.max(0, now - checkedAt) / 1000
        : null;
  if (remaining === null) return source;
  if (remaining <= 0)
    return {
      ...source,
      remainingSeconds: 0,
      status: 'stale',
      reason: 'session_expired',
      message: `La sesión de ${label} venció. Vuelve a iniciar sesión en Eloísa.`,
    };
  return { ...source, expiresAt: now + remaining * 1000, remainingSeconds: remaining };
};

export const normalizeHealthExpiry = (
  report: RayenExtensionHealthReport,
  now = Date.now()
): RayenExtensionHealthReport => {
  const parsed = Date.parse(report.checkedAt);
  const checkedAt = Number.isFinite(parsed) ? parsed : now;
  return {
    ...report,
    fichaMedico: normalizeSourceExpiry(report.fichaMedico, 'Ficha Médico', now, checkedAt),
    gestionCamas: normalizeSourceExpiry(report.gestionCamas, 'Gestión de Camas', now, checkedAt),
  };
};
