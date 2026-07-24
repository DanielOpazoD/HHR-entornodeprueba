import React from 'react';
import { Activity, BedDouble, Info, ShieldCheck, TriangleAlert } from 'lucide-react';

import {
  buildCudyrUpcAnalysis,
  type CudyrUpcAnalysis,
} from '@/features/analytics/controllers/cudyrUpcAnalysisController';
import { formatAnalyticsPercent as formatPercent } from '@/features/analytics/controllers/analyticsPercentageController';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { CudyrCareLevelCharts } from './CudyrCareLevelCharts';

interface CudyrUpcAnalysisSectionProps {
  records: DailyRecord[];
}

interface MetricCardProps {
  label: string;
  value: number | string;
  detail: string;
  tone: 'sky' | 'emerald' | 'amber' | 'rose';
}

const TONE_CLASSES: Record<MetricCardProps['tone'], string> = {
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
};

const MetricCard: React.FC<MetricCardProps> = ({ label, value, detail, tone }) => (
  <div className={`rounded-xl border p-4 ${TONE_CLASSES[tone]}`}>
    <div className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</div>
    <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
    <div className="mt-1 text-xs leading-relaxed opacity-80">{detail}</div>
  </div>
);

const renderCountWithPercent = (value: number, total: number): string =>
  `${value} (${formatPercent(total > 0 ? (value / total) * 100 : 0)})`;

const AdultCapacityBar: React.FC<{ analysis: CudyrUpcAnalysis }> = ({ analysis }) => {
  const total = analysis.adultPotentialOccupied;
  const criteriaWidth = total > 0 ? (analysis.adultPotentialWithCriteria / total) * 100 : 0;
  const legacyWidth = total > 0 ? (analysis.adultPotentialLegacy / total) * 100 : 0;
  const withoutUpcWidth = total > 0 ? Math.max(0, 100 - criteriaWidth - legacyWidth) : 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h4 className="font-bold text-slate-800">Uso observado de R1–R4</h4>
          <p className="text-sm text-slate-500">
            El total UPC combina checklist clínico y registro histórico, manteniendo ambos orígenes
            visibles.
          </p>
        </div>
        <div className="text-sm font-semibold text-slate-700">
          {analysis.adultPotentialOccupied} observaciones
        </div>
      </div>

      <div
        className="mt-4 flex h-4 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`${analysis.adultPotentialWithCriteria} observaciones UPC con checklist, ${analysis.adultPotentialLegacy} UPC históricas y ${analysis.adultPotentialWithoutCriteria} sin registro UPC`}
      >
        <div className="bg-emerald-500" style={{ width: `${criteriaWidth}%` }} />
        <div className="bg-sky-500" style={{ width: `${legacyWidth}%` }} />
        <div className="bg-amber-400" style={{ width: `${withoutUpcWidth}%` }} />
      </div>

      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">
          <dt className="font-medium">UPC con checklist</dt>
          <dd className="mt-0.5 font-bold tabular-nums">
            {renderCountWithPercent(analysis.adultPotentialWithCriteria, total)}
          </dd>
        </div>
        <div className="rounded-lg bg-sky-50 px-3 py-2 text-sky-900">
          <dt className="font-medium">UPC histórico</dt>
          <dd className="mt-0.5 font-bold tabular-nums">
            {renderCountWithPercent(analysis.adultPotentialLegacy, total)}
          </dd>
        </div>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950">
          <dt className="font-medium">Sin registro UPC</dt>
          <dd className="mt-0.5 font-bold tabular-nums">
            {renderCountWithPercent(analysis.adultPotentialWithoutCriteria, total)}
          </dd>
        </div>
      </dl>
    </div>
  );
};

const CohortTable: React.FC<{ analysis: CudyrUpcAnalysis }> = ({ analysis }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4">
      <h4 className="font-bold text-slate-800">Complejidad CUDYR por cohorte</h4>
      <p className="text-sm text-slate-500">
        Distribución por nivel de cuidado en evaluaciones categorizadas.
      </p>
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-[860px] w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-3 py-2 text-left">
              Cohorte
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              Total
            </th>
            <th scope="col" className="px-3 py-2 text-center text-rose-700">
              Crítico
            </th>
            <th scope="col" className="px-3 py-2 text-center text-sky-700">
              Medio
            </th>
            <th scope="col" className="px-3 py-2 text-center text-emerald-700">
              Básico
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {analysis.cohorts.map(cohort => (
            <tr key={cohort.key} className="align-top">
              <th scope="row" className="px-3 py-3 text-left">
                <div className="font-semibold text-slate-800">{cohort.label}</div>
                <div className="mt-0.5 max-w-sm text-xs font-normal text-slate-500">
                  {cohort.description}
                </div>
              </th>
              <td className="px-3 py-3 text-center font-bold text-slate-800 tabular-nums">
                {cohort.categorizedObservations}
              </td>
              <td className="px-3 py-3 text-center tabular-nums text-rose-800">
                {renderCountWithPercent(cohort.critical, cohort.categorizedObservations)}
              </td>
              <td className="px-3 py-3 text-center tabular-nums text-sky-800">
                {renderCountWithPercent(cohort.medium, cohort.categorizedObservations)}
              </td>
              <td className="px-3 py-3 text-center tabular-nums text-emerald-800">
                {renderCountWithPercent(cohort.basic, cohort.categorizedObservations)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const DailyTable: React.FC<{ analysis: CudyrUpcAnalysis }> = ({ analysis }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-4">
      <h4 className="font-bold text-slate-800">Detalle nocturno por fecha</h4>
      <p className="text-sm text-slate-500">
        Permite reconocer si la brecha entre cama asignada y criterio clínico es persistente.
      </p>
    </div>
    <div className="max-h-80 overflow-auto rounded-lg border border-slate-100">
      <table className="min-w-[760px] w-full text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 text-left">
              Fecha
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              R1–R4 ocupadas
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              R1–R4 con UPC
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              UPC histórico
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              R1–R4 sin UPC
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              NEO con UPC
            </th>
            <th scope="col" className="px-3 py-2 text-center">
              CUDYR completos
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {analysis.daily
            .slice()
            .reverse()
            .map(day => (
              <tr key={day.date}>
                <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700">
                  {formatDateDDMMYYYY(day.date)}
                </th>
                <td className="px-3 py-2 text-center tabular-nums">{day.adultPotentialOccupied}</td>
                <td className="px-3 py-2 text-center tabular-nums text-emerald-800">
                  {day.adultPotentialWithUpc}
                </td>
                <td className="px-3 py-2 text-center tabular-nums text-sky-800">
                  {day.adultPotentialLegacy}
                </td>
                <td className="px-3 py-2 text-center tabular-nums text-amber-800">
                  {day.adultPotentialWithoutCriteria}
                </td>
                <td className="px-3 py-2 text-center tabular-nums">{day.neonatalWithUpc}</td>
                <td className="px-3 py-2 text-center tabular-nums">
                  {day.categorizedObservations}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const CudyrUpcAnalysisSection: React.FC<CudyrUpcAnalysisSectionProps> = ({ records }) => {
  const analysis = React.useMemo(() => buildCudyrUpcAnalysis(records), [records]);

  if (analysis.eligibleObservations === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <Activity className="mx-auto h-10 w-10 text-slate-300" />
        <h3 className="mt-3 font-bold text-slate-700">Sin evaluaciones CUDYR analizables</h3>
        <p className="mt-1 text-sm text-slate-500">
          No hay pacientes elegibles en R1–R4, NEO1–NEO2 o H1C1–H6C2 para el período.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5" data-testid="cudyr-upc-analysis">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-sky-700" />
          <div>
            <h3 className="text-lg font-bold text-slate-800">
              Análisis CUDYR y uso de camas críticas
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Compara complejidad CUDYR nocturna, ubicación física y clasificación clínica UPC. Cada
              observación representa un paciente en una noche; no corresponde a pacientes únicos.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="R1–R4 ocupadas"
          value={analysis.adultPotentialOccupied}
          detail="Noches-cama potencialmente UTI observadas"
          tone="sky"
        />
        <MetricCard
          label="R1–R4 con registro UPC"
          value={renderCountWithPercent(
            analysis.adultPotentialWithUpc,
            analysis.adultPotentialOccupied
          )}
          detail={`${analysis.adultPotentialWithCriteria} checklist · ${analysis.adultPotentialLegacy} históricos`}
          tone="emerald"
        />
        <MetricCard
          label="R1–R4 sin registro UPC"
          value={renderCountWithPercent(
            analysis.adultPotentialWithoutCriteria,
            analysis.adultPotentialOccupied
          )}
          detail="Uso de cama potencialmente UTI sin checklist ni marca histórica"
          tone="amber"
        />
        <MetricCard
          label="UPC observadas"
          value={analysis.upcObserved}
          detail={`${analysis.upcWithCriteria} con checklist · ${analysis.upcLegacy} históricas`}
          tone="rose"
        />
      </div>

      <AdultCapacityBar analysis={analysis} />

      <CudyrCareLevelCharts analysis={analysis} />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-slate-700">
            <BedDouble className="h-5 w-5 text-sky-600" />
            <span className="font-semibold">Camas básicas</span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-800">{analysis.basicOccupied}</div>
          <p className="text-xs text-slate-500">Observaciones elegibles en H1C1–H6C2</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-semibold text-slate-700">NEO1–NEO2</div>
          <div className="mt-2 text-2xl font-bold text-slate-800">
            {analysis.neonatalWithUpc} / {analysis.neonatalOccupied}
          </div>
          <p className="text-xs text-slate-500">Con checklist o registro UPC histórico</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="font-semibold text-slate-700">Cobertura CUDYR</div>
          <div className="mt-2 text-2xl font-bold text-slate-800">
            {formatPercent(analysis.coveragePercent)}
          </div>
          <p className="text-xs text-slate-500">
            {analysis.categorizedObservations} de {analysis.eligibleObservations} observaciones
            elegibles
          </p>
        </div>
      </div>

      {analysis.upcLegacy > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Registros que requieren interpretación cautelosa</div>
            <p className="mt-1">
              {analysis.upcLegacy > 0 &&
                `${analysis.upcLegacy} observaciones UPC históricas no tienen desglose UTI/UCI; ${analysis.upcAssumedUti} anteriores al 30-04-2026 se contabilizan como UTI asumida y ${analysis.upcLegacy - analysis.upcAssumedUti} quedan sin clasificación. `}
            </p>
          </div>
        </div>
      )}

      {analysis.excludedUnidentifiedObservations > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <Info className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            Se excluyeron {analysis.excludedUnidentifiedObservations} observaciones UPC sin nombre
            ni documento de identidad. No participan en totales, porcentajes ni tablas.
          </p>
        </div>
      )}

      <CohortTable analysis={analysis} />
      <DailyTable analysis={analysis} />

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p>
          CUDYR describe riesgo y dependencia; desde el 30-04-2026 la condición UPC se determina por
          checklist clínico UTI/UCI. Antes de esa fecha, la marca manual “UPC” se conserva como tal
          y se contabiliza estadísticamente como UTI asumida. Este análisis no convierte por sí solo
          una categoría CUDYR en indicación UPC.
        </p>
      </div>
    </section>
  );
};
