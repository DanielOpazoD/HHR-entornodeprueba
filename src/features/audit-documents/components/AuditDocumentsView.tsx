import React, { useMemo, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';

import {
  AUDIT_DOCUMENT_TYPE_LABELS,
  AUDIT_DOCUMENTS_MAX_DOCUMENTS,
  AUDIT_DOCUMENTS_MAX_PATIENTS,
  displayRut,
  parseRutList,
  resolvePatientRanges,
  type AuditDateRange,
  type AuditDocumentType,
} from '../domain/auditDocumentsRequest';
import type { AuditDocumentsProgress } from '../services/auditDocumentsBridge';
import { useAuditDocumentsDownload } from '../hooks/useAuditDocumentsDownload';
import { AuditDocumentsResultPanel } from './AuditDocumentsResultPanel';

const DOCUMENT_TYPES: AuditDocumentType[] = ['history', 'pharmacological'];

const dateInputClass =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 focus:border-sky-500 focus:outline-none';

const progressText = (progress: AuditDocumentsProgress): string => {
  if (progress.phase === 'listing') {
    return `Buscando hospitalizaciones en Eloísa: ${progress.done} de ${progress.total} RUT…`;
  }
  if (progress.phase === 'downloading') {
    return `Descargando documentos: ${progress.done} de ${progress.total}…`;
  }
  if (progress.phase === 'retrying') {
    return `Reintentando los documentos que Eloísa no entregó: ${progress.done} de ${progress.total}…`;
  }
  if (progress.phase === 'packing') return 'Armando el archivo ZIP…';
  return 'Conectando con la extensión Eloísa…';
};

export const AuditDocumentsView: React.FC = () => {
  const [rutText, setRutText] = useState('');
  const [general, setGeneral] = useState<AuditDateRange>({ dateFrom: '', dateTo: '' });
  const [overrides, setOverrides] = useState<Record<string, Partial<AuditDateRange>>>({});
  const [documentTypes, setDocumentTypes] = useState<AuditDocumentType[]>(DOCUMENT_TYPES);
  const { progress, result, running, start, cancel } = useAuditDocumentsDownload();

  const parsed = useMemo(() => parseRutList(rutText), [rutText]);
  const ranges = useMemo(
    () => resolvePatientRanges(parsed.runs, general, overrides),
    [parsed.runs, general, overrides]
  );
  const tooMany = parsed.runs.length > AUDIT_DOCUMENTS_MAX_PATIENTS;
  const generalInverted = Boolean(
    general.dateFrom && general.dateTo && general.dateFrom > general.dateTo
  );
  const blocker =
    parsed.runs.length === 0
      ? 'Ingresa al menos un RUT válido.'
      : tooMany
        ? `Se pueden pedir como máximo ${AUDIT_DOCUMENTS_MAX_PATIENTS} RUT por descarga.`
        : parsed.invalid.length > 0
          ? 'Corrige o quita los valores que no son un RUT válido.'
          : ranges.invertedRuns.length > 0 || generalInverted
            ? 'Hay una fecha «desde» posterior a su fecha «hasta».'
            : documentTypes.length === 0
              ? 'Elige al menos un tipo de documento.'
              : '';

  const setOverride = (run: string, field: keyof AuditDateRange, value: string) =>
    setOverrides(current => ({ ...current, [run]: { ...current[run], [field]: value } }));

  const toggleType = (type: AuditDocumentType) =>
    setDocumentTypes(current =>
      current.includes(type) ? current.filter(item => item !== type) : [...current, type]
    );

  return (
    <div className="mx-auto max-w-[1100px] animate-in fade-in px-4 py-4 duration-700 md:px-6 md:py-6">
      <header className="mb-6">
        <div className="mb-2 flex items-center gap-3">
          <div className="rounded-2xl bg-sky-600 p-2 text-white shadow-lg shadow-sky-100">
            <FileDown size={20} />
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight text-slate-900 md:text-[2rem]">
            Documentos para auditoría
          </h1>
        </div>
        <p className="max-w-3xl text-sm font-medium leading-snug text-slate-500 md:text-[15px]">
          Descarga en un ZIP los informes oficiales de Eloísa de hasta{' '}
          {AUDIT_DOCUMENTS_MAX_PATIENTS} pacientes: un PDF por hospitalización, con nombre, RUT y
          tipo de documento. Necesita Ficha Médico abierta en este computador. Máximo{' '}
          {AUDIT_DOCUMENTS_MAX_DOCUMENTS} documentos por descarga.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
          <label htmlFor="audit-documents-ruts" className="text-sm font-bold text-slate-800">
            RUT de los pacientes
          </label>
          <p className="mb-2 text-xs font-medium text-slate-500">
            Uno por línea o separados por coma. Puedes pegarlos desde una planilla.
          </p>
          <textarea
            id="audit-documents-ruts"
            value={rutText}
            onChange={event => setRutText(event.target.value)}
            disabled={running}
            rows={8}
            className="w-full rounded-xl border border-slate-200 p-3 font-mono text-sm text-slate-800 focus:border-sky-500 focus:outline-none"
            placeholder={'11.111.111-1\n12345678-5'}
          />
          <p className="mt-2 text-xs font-semibold text-slate-600">
            {parsed.runs.length} de {AUDIT_DOCUMENTS_MAX_PATIENTS} RUT
            {parsed.repeated > 0 ? ` · ${parsed.repeated} repetido(s) omitido(s)` : ''}
          </p>
          {parsed.invalid.length > 0 && (
            <p role="alert" className="mt-1 text-xs font-semibold text-rose-700">
              No son un RUT válido: {parsed.invalid.join(', ')}
            </p>
          )}

          <fieldset className="mt-5">
            <legend className="text-sm font-bold text-slate-800">Fechas para todos</legend>
            <p className="mb-2 text-xs font-medium text-slate-500">
              Incluye las hospitalizaciones que se cruzan con este periodo. Sin fechas, se incluyen
              todas.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Desde (todos)"
                value={general.dateFrom}
                disabled={running}
                onChange={event =>
                  setGeneral(current => ({ ...current, dateFrom: event.target.value }))
                }
                className={dateInputClass}
              />
              <span className="text-xs font-semibold text-slate-400">a</span>
              <input
                type="date"
                aria-label="Hasta (todos)"
                value={general.dateTo}
                disabled={running}
                onChange={event =>
                  setGeneral(current => ({ ...current, dateTo: event.target.value }))
                }
                className={dateInputClass}
              />
            </div>
          </fieldset>

          <fieldset className="mt-5">
            <legend className="text-sm font-bold text-slate-800">Documentos</legend>
            {DOCUMENT_TYPES.map(type => (
              <label key={type} className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={documentTypes.includes(type)}
                  disabled={running}
                  onChange={() => toggleType(type)}
                />
                {AUDIT_DOCUMENT_TYPE_LABELS[type]}
              </label>
            ))}
          </fieldset>
        </section>

        <section className="rounded-[1.75rem] border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-bold text-slate-800">Fechas por paciente</h2>
          <p className="mb-3 text-xs font-medium text-slate-500">
            Opcional. Una fecha vacía usa la de «Fechas para todos».
          </p>
          {parsed.runs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs font-semibold text-slate-500">
              Los RUT válidos aparecerán aquí.
            </p>
          ) : (
            <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {parsed.runs.map(run => (
                <li key={run} className="flex flex-wrap items-center gap-2">
                  <span className="w-28 font-mono text-sm font-semibold text-slate-800">
                    {displayRut(run)}
                  </span>
                  <input
                    type="date"
                    aria-label={`Desde para ${displayRut(run)}`}
                    value={overrides[run]?.dateFrom ?? ''}
                    disabled={running}
                    onChange={event => setOverride(run, 'dateFrom', event.target.value)}
                    className={dateInputClass}
                  />
                  <input
                    type="date"
                    aria-label={`Hasta para ${displayRut(run)}`}
                    value={overrides[run]?.dateTo ?? ''}
                    disabled={running}
                    onChange={event => setOverride(run, 'dateTo', event.target.value)}
                    className={dateInputClass}
                  />
                  {ranges.invertedRuns.includes(run) && (
                    <span className="text-xs font-semibold text-rose-700">Fechas invertidas</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={Boolean(blocker) || running}
          onClick={() => void start(ranges.patients, documentTypes)}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-[0.2em] text-white transition hover:bg-black disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          Descargar ZIP
        </button>
        {running && (
          <button
            type="button"
            onClick={cancel}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        )}
        {progress ? (
          <p role="status" className="text-sm font-semibold text-slate-600">
            {progressText(progress)}
          </p>
        ) : (
          blocker && <p className="text-sm font-semibold text-slate-500">{blocker}</p>
        )}
      </div>

      {result && <AuditDocumentsResultPanel result={result} />}
    </div>
  );
};
