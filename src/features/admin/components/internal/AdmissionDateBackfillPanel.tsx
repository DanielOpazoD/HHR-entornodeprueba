import React from 'react';
import { AlertCircle, Search, Wrench } from 'lucide-react';
import clsx from 'clsx';
import type { AdmissionDateBackfillResult } from '@/features/admin/services/admissionDateBackfillService';

interface AdmissionDateBackfillPanelProps {
  isAuditing: boolean;
  isApplying: boolean;
  result: AdmissionDateBackfillResult | null;
  error: string | null;
  progress: { current: number; total: number };
  onAudit: () => void;
  onApply: () => void;
}

export const AdmissionDateBackfillPanel: React.FC<AdmissionDateBackfillPanelProps> = ({
  isAuditing,
  isApplying,
  result,
  error,
  progress,
  onAudit,
  onApply,
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <Search className="text-amber-600" size={20} />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold leading-none text-slate-800">
            Auditoría y corrección de fechas de ingreso
          </h3>
          <p className="max-w-2xl text-[11px] leading-relaxed text-slate-500">
            Revisa el histórico y corrige{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-slate-700">admissionDate</code>{' '}
            cuando no coincide con la primera aparición del paciente en censo. La política usa la
            fecha de primera observación y la hora de ingreso si está disponible.
          </p>
          {result && (
            <div className="flex flex-wrap gap-2 pt-2 text-[11px] font-bold">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                {result.scannedDays} días revisados
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
                {result.reviewedEntries} casos evaluados
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">
                {result.correctionCount} correcciones
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onAudit}
          disabled={isAuditing || isApplying}
          className={clsx(
            'flex items-center gap-2 rounded-xl border px-5 py-3 text-sm font-bold transition-all',
            isAuditing || isApplying
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : 'border-amber-200 bg-white text-amber-700 hover:border-amber-300 hover:bg-amber-50'
          )}
        >
          <Search size={16} />
          {isAuditing ? 'Auditando...' : 'Auditar fechas'}
        </button>
        <button
          onClick={onApply}
          disabled={isAuditing || isApplying || !result || result.correctionCount === 0}
          className={clsx(
            'flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold shadow-md transition-all',
            isAuditing || isApplying || !result || result.correctionCount === 0
              ? 'cursor-not-allowed bg-slate-100 text-slate-400 shadow-none'
              : 'bg-amber-600 text-white shadow-amber-100 hover:bg-amber-700'
          )}
        >
          <Wrench size={16} />
          {isApplying ? 'Corrigiendo...' : 'Aplicar correcciones'}
        </button>
      </div>
    </div>

    {isApplying && progress.total > 0 && (
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-slate-500">
          <span>Procesando corrección histórica</span>
          <span>
            {progress.current}/{progress.total}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-amber-500 transition-all duration-300"
            style={{
              width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : '0%',
            }}
          />
        </div>
      </div>
    )}

    {error && (
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs font-bold text-rose-700">
        <AlertCircle size={14} />
        {error}
      </div>
    )}

    {result && (
      <div className="mt-4 space-y-4">
        <div
          className={clsx(
            'rounded-2xl border p-4 text-sm',
            result.correctionCount > 0
              ? 'border-amber-100 bg-amber-50 text-amber-900'
              : 'border-emerald-100 bg-emerald-50 text-emerald-900'
          )}
        >
          <div className="mb-1 font-bold">{result.userSafeMessage}</div>
          <div className="text-[11px] font-medium text-slate-600">
            Resultado: {result.outcome} · Registros tocados: {result.touchedRecords} · Aplicados:{' '}
            {result.appliedRecords}
            {result.failedRecords > 0 ? ` · Fallidos: ${result.failedRecords}` : ''}
          </div>
        </div>

        {result.samples.length > 0 && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h4 className="mb-3 text-[11px] font-black uppercase tracking-wider text-slate-500">
              Muestras de corrección
            </h4>
            <div className="space-y-2">
              {result.samples.map(sample => (
                <div
                  key={`${sample.date}-${sample.bedId}-${sample.scope}-${sample.rut}`}
                  className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] md:flex-row md:items-center md:justify-between"
                >
                  <div className="font-bold text-slate-700">
                    {sample.date} · {sample.patientName}
                    <span className="font-medium text-slate-400"> ({sample.bedName})</span>
                  </div>
                  <div className="text-slate-500">
                    {sample.previousAdmissionDate || 'sin fecha'} → {sample.suggestedAdmissionDate}
                    {' · '}FI {sample.firstSeenDate}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )}
  </div>
);
