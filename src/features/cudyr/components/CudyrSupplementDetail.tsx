import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import { supplementCandidates } from '@/services/cudyr/cudyrSupplementPresentation';
export const CudyrSupplementDetail = ({
  reports,
  document,
  ready = true,
}: {
  reports: ArchivedCudyrSupplement[];
  document: string;
  ready?: boolean;
}) => {
  const candidates = supplementCandidates(reports, document);
  if (!ready)
    return (
      <p className="rounded-lg border p-3 text-sm text-amber-800">
        Respaldo mensual pendiente de lectura. No se puede confirmar si hay coincidencias.
      </p>
    );
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Evidencia del informe mensual ({candidates.length} coincidencias)
      </summary>
      <p className="mt-3 text-slate-600">
        Coincidencia de documento, sin vínculo confirmado con esta hospitalización. Fechas
        originales del mes, sin aplicar el ajuste de turno de HHR. No modifica la categoría diaria.
      </p>
      {!candidates.length && (
        <p className="mt-2 text-slate-500">
          No se encontró una coincidencia segura de documento en los archivos cargados.
        </p>
      )}
      {candidates.map(({ archive, patient }) => (
        <div key={archive.id + ':' + patient.sourceRow} className="mt-3 border-t pt-2">
          <p className="font-medium">
            {archive.file.name} · {archive.month} · versión {archive.id.slice(0, 8)} · fila{' '}
            {patient.sourceRow}
          </p>
          <p>
            {patient.patientName} · {patient.document} · {patient.service}
          </p>
          <p>{patient.diagnosis}</p>
          <p className="mt-1 text-xs">
            {patient.days
              .filter(d => d.state !== 'blank')
              .map(d => `${d.sourceDate}: ${d.originalValue}`)
              .join(' · ') || 'Sin categorías informadas.'}
          </p>
        </div>
      ))}
    </details>
  );
};
