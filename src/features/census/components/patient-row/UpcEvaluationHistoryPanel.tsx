import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { PatientData } from './patientRowContracts';
import type { UpcEvaluationSnapshot } from '@/domain/upc/upcContracts';
import {
  checklistUpcHistory,
  upcCriterionLabels,
  upcEvaluationKey,
} from '@/domain/upc/upcEvaluationHistory';
import { formatDateDDMMYYYY, formatDateTimeCL } from '@/utils/dateDisplayUtils';

const dateLabel = (date: string) => formatDateDDMMYYYY(date).replace(/^0(\d-)/, '$1');
const PAGE_SIZE = 4;

export const UpcEvaluationHistoryPanel = ({
  patient,
  date,
}: {
  patient: PatientData;
  date: string;
}) => {
  const [entries, setEntries] = useState<UpcEvaluationSnapshot[]>(() =>
    checklistUpcHistory(patient.upcChecklist)
  );
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPage(0);
    setEntries(checklistUpcHistory(patient.upcChecklist));
    setWarning(null);
    void import('@/services/patient/patientUpcHistoryService')
      .then(service => service.loadPatientUpcHistory(patient, date))
      .then(result => {
        if (!cancelled) {
          setEntries(result.entries);
          setWarning(result.warning);
        }
      })
      .catch(() => {
        if (!cancelled)
          setWarning(
            'No se pudo cargar el historial. Se muestra el registro actual; vuelve a intentar.'
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patient, date, reload]);

  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  return (
    <section
      className="min-h-0 overflow-y-auto px-3 py-2 text-xs"
      aria-label="Historial de evaluaciones UPC"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-800">{patient.patientName}</p>
          <p className="text-[10px] text-slate-500">
            Hospitalización · hasta el censo del {dateLabel(date)}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setReload(value => value + 1)}
          aria-label="Actualizar historial UPC"
          className="rounded p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {loading && (
        <p role="status" className="mb-2 text-slate-500">
          Consultando evaluaciones guardadas…
        </p>
      )}
      {warning && (
        <p role="status" className="mb-2 rounded bg-amber-50 p-2 text-amber-900">
          {warning}
        </p>
      )}
      {!loading && !entries.length && (
        <p className="py-4 text-center text-slate-500">
          No hay evaluaciones UPC guardadas disponibles.
        </p>
      )}
      <ol className="space-y-2">
        {entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(entry => {
          const criteria = upcCriterionLabels(entry);
          const signed = Boolean(
            entry.evaluatedBy?.uid &&
            entry.responsibleNurse?.name &&
            entry.evaluatedForDate &&
            entry.evaluatedBedId
          );
          return (
            <li
              key={upcEvaluationKey(entry)}
              className="rounded-lg border border-slate-200 bg-white p-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-1">
                <time dateTime={entry.evaluatedAt} className="font-semibold text-slate-800">
                  {formatDateTimeCL(entry.evaluatedAt).replace(/^0(\d-)/, '$1')}
                </time>
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">
                  {entry.classification === 'UPC_UCI'
                    ? 'UCI'
                    : entry.classification === 'UPC_UTI'
                      ? 'UTI'
                      : 'Sin criterios UPC'}
                </span>
              </div>
              <p className="mt-1 text-slate-700">
                {entry.responsibleNurse?.name ||
                  entry.evaluatedBy?.displayName ||
                  'Responsable no registrado'}
              </p>
              <p className="text-[10px] text-slate-500">
                Censo:{' '}
                {entry.evaluatedForDate
                  ? dateLabel(entry.evaluatedForDate)
                  : 'sin fecha registrada'}{' '}
                · Cama: {entry.evaluatedBedId || 'no registrada'}
              </p>
              {!signed && (
                <p className="text-[10px] text-amber-800">Registro anterior sin firma completa</p>
              )}
              <details className="mt-1">
                <summary className="cursor-pointer text-emerald-800 focus-visible:outline-emerald-600">
                  Ver criterios y registro
                </summary>
                {criteria.length ? (
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-600">
                    {criteria.map((label, index) => (
                      <li key={index}>{label}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-slate-600">Evaluado sin criterios UPC.</p>
                )}
                {!entry.criterionLabels && criteria.length > 0 && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    Registro antiguo: descripciones del catálogo actual.
                  </p>
                )}
                <p className="mt-1 text-[10px] text-slate-500">
                  Registrado por: {entry.evaluatedBy?.displayName || 'cuenta no registrada'}
                </p>
              </details>
            </li>
          );
        })}
      </ol>
      {entries.length > 0 && (
        <div className="mt-2 flex items-center justify-between text-slate-600">
          <span>
            {entries.length} evaluaciones · {page + 1}/{pages}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Evaluaciones más recientes"
              disabled={page === 0}
              onClick={() => setPage(value => value - 1)}
              className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              aria-label="Evaluaciones anteriores"
              disabled={page + 1 >= pages}
              onClick={() => setPage(value => value + 1)}
              className="rounded p-1.5 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] text-slate-500">
        Antes de incorporar este historial, HHR conservaba solo la última evaluación de cada día.
        Las reemplazadas no se pueden reconstruir.
      </p>
    </section>
  );
};
