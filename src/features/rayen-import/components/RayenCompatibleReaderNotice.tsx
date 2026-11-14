import { SYNC_TONE } from './syncTone';
import type { RayenExtensionHealthReport } from '../bridge/extensionHealthBridge';
import type { RayenExtensionConnectionState } from '../hooks/useRayenExtensionHealth';

export const RayenCompatibleReaderNotice = ({
  report,
  connection,
}: {
  report: RayenExtensionHealthReport | null;
  connection: RayenExtensionConnectionState;
}) => {
  if (connection !== 'ready' || !report) return null;
  const readers = [
    report.fichaMedico.status === 'ready' &&
    report.fichaMedico.bridgeVersion &&
    report.fichaMedico.bridgeVersion !== report.version
      ? 'Ficha Médico'
      : null,
    report.gestionCamas.status === 'ready' &&
    report.gestionCamas.bridgeVersion &&
    report.gestionCamas.bridgeVersion !== report.version
      ? 'Gestión de Camas'
      : null,
  ].filter((label): label is string => Boolean(label));
  if (readers.length === 0) return null;

  return (
    <p
      data-testid="rayen-compatible-reader-version-notice"
      className={`mt-2 rounded-md border px-2 py-1.5 text-[11px] leading-snug ${SYNC_TONE.review.surface}`}
    >
      Abre una pestaña nueva de {readers.join(' y ')} para cargar el lector actual (extensión v
      {report.version}). La sincronización sigue disponible.
    </p>
  );
};
