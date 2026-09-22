import type { HistoricalRecoveryDay } from '../contracts/censusImportDiff';

export const HistoricalRecoveryPreview = ({ days }: { days: HistoricalRecoveryDay[] }) => (
  <div className="mt-3 space-y-2 text-sm text-amber-900">
    <p>
      Recuperar censos sin información con trazabilidad de Eloísa. Las observaciones clínicas
      actuales no se copiarán a días anteriores.
    </p>
    {days.map(day => (
      <details key={day.day} className="rounded border border-amber-200 p-2">
        <summary>
          {day.day} · {day.recordExists ? 'Completar censo vacío' : 'Crear censo'} ·{' '}
          {day.admissions.length} camas · {day.reportEgresos.length} egresos
          {day.conflicts.length > 0 && ` · ${day.conflicts.length} pendientes de revisión`}
          {!day.withinEditingWindow && ' · Requiere administrador; se omitirá'}
          {day.admissions.length === 0 &&
            day.reportEgresos.length === 0 &&
            ' · Sin evidencia suficiente; no se creará'}
        </summary>
        <ul className="mt-2 space-y-1">
          {day.admissions.map(item => (
            <li key={item.bedId}>
              {item.bedId}: {item.patient.patientName}
              {item.patient.clinicalCrib && ` · Cuna: ${item.patient.clinicalCrib.patientName}`}
            </li>
          ))}
          {day.reportEgresos.map((item, index) => (
            <li key={`egreso-${index}`}>
              Egreso: {item.patientName} · {item.correctedTime}
            </li>
          ))}
          {day.conflicts.map((item, index) => (
            <li key={`conflict-${index}`}>
              Pendiente: {item.patientName ?? item.bedId ?? 'Episodio'} · {item.reason}
            </li>
          ))}
        </ul>
      </details>
    ))}
  </div>
);
