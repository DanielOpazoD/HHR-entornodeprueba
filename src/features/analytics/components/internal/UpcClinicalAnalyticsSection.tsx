import React from 'react';
import { Activity, Info, ShieldCheck } from 'lucide-react';

import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import { formatAnalyticsPercent as formatPercent } from '@/features/analytics/controllers/analyticsPercentageController';
import { buildUpcClinicalAnalytics } from '@/features/analytics/controllers/upcClinicalAnalyticsController';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

interface UpcClinicalAnalyticsSectionProps {
  records: DailyRecord[];
}

export const UpcClinicalAnalyticsSection: React.FC<UpcClinicalAnalyticsSectionProps> = ({
  records,
}) => {
  const analysis = React.useMemo(() => buildUpcClinicalAnalytics(records), [records]);

  if (analysis.observations === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Activity className="mx-auto h-10 w-10 text-slate-300" />
        <h3 className="mt-3 font-bold text-slate-700">Sin pacientes UPC clasificables</h3>
        <p className="mt-1 text-sm text-slate-500">
          No hay checklist UTI/UCI ni registros manuales UPC anteriores al 30-04-2026.
        </p>
        {analysis.excludedUnidentifiedObservations > 0 ? (
          <p className="mt-3 text-sm font-medium text-slate-600">
            Se excluyeron {analysis.excludedUnidentifiedObservations} observaciones sin nombre ni
            documento de identidad.
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="space-y-5" data-testid="upc-clinical-analytics">
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-violet-700" />
          <div>
            <h3 className="text-lg font-bold text-slate-800">Pacientes UPC según criterios HHR</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Considera clasificaciones estructuradas del checklist y registros manuales “UPC”
              anteriores al 30-04-2026. Estos últimos se contabilizan como UTI asumida, conservando
              visible su origen histórico. Solo se aceptan clasificaciones ubicadas en R1–R4 o
              NEO1–NEO2.
            </p>
          </div>
        </div>
      </div>

      {analysis.excludedUnidentifiedObservations > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Se excluyeron {analysis.excludedUnidentifiedObservations} observaciones UPC sin nombre
            ni documento de identidad. No participan en totales, porcentajes ni detalle.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Pacientes identificados
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-slate-800">
            {analysis.uniquePatients}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {analysis.observations} observaciones paciente-noche
          </p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-800">UPC–UCI</div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-rose-800">
            {analysis.uciObservations}
          </div>
          <p className="mt-1 text-xs text-rose-700">
            {analysis.uniqueUciPatients} pacientes · {formatPercent(analysis.uciPercent)} de noches
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            UPC–UTI
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-amber-900">
            {analysis.utiObservations}
          </div>
          <p className="mt-1 text-xs text-amber-800">
            {analysis.uniqueUtiPatients} pacientes · {formatPercent(analysis.utiPercent)} de noches
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-800">
            UTI asumida histórica
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-sky-800">
            {analysis.assumedUtiObservations}
          </div>
          <p className="mt-1 text-xs text-sky-700">Registro manual “UPC” antes del corte</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Distribución clínica UCI / UTI</h4>
        <div
          className="mt-4 flex h-8 overflow-hidden rounded-lg bg-slate-100"
          role="img"
          aria-label={`${analysis.uciObservations} observaciones UPC-UCI y ${analysis.utiObservations} observaciones UPC-UTI`}
        >
          <div className="bg-rose-500" style={{ width: `${analysis.uciPercent}%` }} />
          <div className="bg-amber-400" style={{ width: `${analysis.utiPercent}%` }} />
        </div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="text-rose-800">
            <strong>UPC–UCI: {analysis.uciObservations}</strong> (
            {formatPercent(analysis.uciPercent)})
          </div>
          <div className="text-amber-900">
            <strong>UPC–UTI: {analysis.utiObservations}</strong> (
            {formatPercent(analysis.utiPercent)})
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Clasificación por ubicación de cama</h4>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {analysis.byBedGroup.map(group => (
            <div key={group.key} className="rounded-lg border border-slate-200 p-4">
              <div className="font-semibold text-slate-700">{group.label}</div>
              <div
                className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100"
                role="img"
                aria-label={`${group.label}: ${group.uci} UPC-UCI y ${group.uti} UPC-UTI`}
              >
                <div
                  className="bg-rose-500"
                  style={{ width: `${group.total > 0 ? (group.uci / group.total) * 100 : 0}%` }}
                />
                <div
                  className="bg-amber-400"
                  style={{ width: `${group.total > 0 ? (group.uti / group.total) * 100 : 0}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-slate-600">
                UCI: <strong>{group.uci}</strong> · UTI: <strong>{group.uti}</strong> · Total:{' '}
                <strong>{group.total}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Detalle de pacientes clasificados</h4>
        <p className="mt-1 text-sm text-slate-500">
          Cada fila corresponde a una observación nocturna identificable del período.
        </p>
        <div className="mt-4 max-h-[32rem] overflow-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">RUT</th>
                <th className="px-3 py-2">Diagnóstico</th>
                <th className="px-3 py-2">Especialidad</th>
                <th className="px-3 py-2">Cama</th>
                <th className="px-3 py-2">Clasificación</th>
                <th className="px-3 py-2">Origen</th>
                <th className="px-3 py-2">CUDYR</th>
                <th className="px-3 py-2">Criterios registrados</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analysis.details
                .slice()
                .reverse()
                .map(detail => (
                  <tr key={detail.id} className="align-top hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-3">
                      {formatDateDDMMYYYY(detail.date)}
                    </td>
                    <td className="px-3 py-3 font-medium text-slate-800">{detail.patientName}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">
                      {detail.rut || '—'}
                    </td>
                    <td className="max-w-xs px-3 py-3 text-slate-600">{detail.diagnosis || '—'}</td>
                    <td className="px-3 py-3 text-slate-600">{detail.specialty || '—'}</td>
                    <td className="px-3 py-3 font-semibold">{detail.bedId}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${
                          detail.classification === 'UPC_UCI'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {detail.classification === 'UPC_UCI'
                          ? 'UPC–UCI'
                          : detail.classificationSource === 'legacy_manual_upc'
                            ? 'UPC → UTI asumida'
                            : 'UPC–UTI'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {detail.classificationSource === 'legacy_manual_upc'
                        ? 'Registro manual UPC'
                        : 'Checklist HHR'}
                    </td>
                    <td className="px-3 py-3 font-bold text-slate-700">
                      {detail.cudyrCategory || '—'}
                    </td>
                    <td className="max-w-md px-3 py-3 text-xs leading-relaxed text-slate-600">
                      {detail.criteria.length > 0 ? detail.criteria.join(' · ') : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Los totales principales son observaciones paciente-noche; la tarjeta de pacientes
          identificados deduplica episodios clínicos. Un mismo paciente puede aparecer en UTI y UCI
          si su clasificación cambió durante el período. La regla histórica UTI solo se aplica a
          fechas estrictamente anteriores al 30-04-2026 y en camas UPC válidas. Cualquier rótulo UPC
          en otras camas se excluye completamente de estos recuentos y de esta tabla.
        </p>
      </div>
    </section>
  );
};
