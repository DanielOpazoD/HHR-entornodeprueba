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
      className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-snug text-amber-800"
    >
      La pestaña comprobada de {readers.join(' y ')} conserva un lector de otra versión (extensión v
      {report.version}). Abre una pestaña nueva para cargar el lector actual. La sincronización
      sigue disponible.
    </p>
  );
};
