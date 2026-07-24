import React from 'react';
import { Info } from 'lucide-react';

import type {
  CudyrCareLevelBedGroupDistribution,
  CudyrCareLevelDistribution,
} from '@/features/analytics/controllers/cudyrCareLevelController';
import type {
  CudyrUpcAnalysis,
  HhrUpcCareLevelDistribution,
} from '@/features/analytics/controllers/cudyrUpcAnalysisController';

interface CudyrCareLevelChartsProps {
  analysis: CudyrUpcAnalysis;
}

interface CareLevelBarProps {
  distribution: CudyrCareLevelDistribution;
  label: string;
}

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const CareLevelBar: React.FC<CareLevelBarProps> = ({ distribution, label }) => {
  const hasCategorizedData = distribution.categorizedObservations > 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <span className="font-semibold text-slate-800">{label}</span>
        <span className="text-xs tabular-nums text-slate-500">
          {distribution.categorizedObservations} CUDYR completos
        </span>
      </div>
      <div
        className="mt-3 flex h-6 overflow-hidden rounded-md bg-slate-100"
        role="img"
        aria-label={`${label}: ${distribution.critical} críticos, ${distribution.medium} medios y ${distribution.basic} básicos`}
      >
        {hasCategorizedData ? (
          <>
            <div className="bg-rose-500" style={{ width: `${distribution.criticalPercent}%` }} />
            <div className="bg-sky-500" style={{ width: `${distribution.mediumPercent}%` }} />
            <div className="bg-emerald-500" style={{ width: `${distribution.basicPercent}%` }} />
          </>
        ) : (
          <div className="flex w-full items-center justify-center text-[10px] font-medium text-slate-400">
            Sin CUDYR completo
          </div>
        )}
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-md bg-rose-50 px-3 py-2 text-rose-900">
          <dt className="font-medium">Crítico</dt>
          <dd className="mt-0.5 font-bold tabular-nums">
            {distribution.critical} ({formatPercent(distribution.criticalPercent)})
          </dd>
        </div>
        <div className="rounded-md bg-sky-50 px-3 py-2 text-sky-900">
          <dt className="font-medium">Medio</dt>
          <dd className="mt-0.5 font-bold tabular-nums">
            {distribution.medium} ({formatPercent(distribution.mediumPercent)})
          </dd>
        </div>
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">
          <dt className="font-medium">Básico</dt>
          <dd className="mt-0.5 font-bold tabular-nums">
            {distribution.basic} ({formatPercent(distribution.basicPercent)})
          </dd>
        </div>
      </dl>
      {distribution.missingCudyr > 0 ? (
        <p className="mt-2 text-[11px] text-slate-500">
          {distribution.missingCudyr} observaciones sin CUDYR, excluidas del porcentaje.
        </p>
      ) : null}
    </div>
  );
};

const BedGroupComparison: React.FC<{ groups: CudyrCareLevelBedGroupDistribution[] }> = ({
  groups,
}) => (
  <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
    <h4 className="font-bold text-slate-800">Nivel de cuidado sin registro UPC, por cama</h4>
    <p className="mt-1 text-sm text-slate-500">
      Permite detectar complejidad crítica fuera de una clasificación UPC registrada.
    </p>
    <div className="mt-4 grid gap-3 xl:grid-cols-3">
      {groups.map(group => (
        <CareLevelBar key={group.key} distribution={group} label={group.label} />
      ))}
    </div>
  </section>
);

const UpcComparison: React.FC<{ groups: HhrUpcCareLevelDistribution[] }> = ({ groups }) => (
  <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-5">
    <h4 className="font-bold text-slate-800">Nivel de cuidado en observaciones UPC</h4>
    <p className="mt-1 text-sm leading-relaxed text-slate-500">
      Incluye checklist UCI/UTI y UPC histórico como grupos separados, pero todos forman parte del
      total UPC observado.
    </p>
    <div className="mt-4 grid gap-3 xl:grid-cols-3">
      {groups.map(group => (
        <CareLevelBar key={group.key} distribution={group} label={group.label} />
      ))}
    </div>
  </section>
);

export const CudyrCareLevelCharts: React.FC<CudyrCareLevelChartsProps> = ({ analysis }) => {
  const distribution = analysis.nonUpcCareLevels;

  return (
    <div className="space-y-4" data-testid="cudyr-care-levels">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Clasificación CUDYR por nivel de cuidado</h4>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Cada categoría CUDYR pertenece a un único nivel. Los recuentos y porcentajes se muestran
          juntos para evitar interpretar una proporción sin conocer su volumen.
        </p>
        <dl className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
            <dt className="font-bold text-rose-900">Crítico</dt>
            <dd className="mt-1 text-sm text-rose-800">A1 · A2 · A3 · B1 · B2</dd>
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
            <dt className="font-bold text-sky-900">Medio</dt>
            <dd className="mt-1 text-sm text-sky-800">B3 · C1 · C2</dd>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <dt className="font-bold text-emerald-900">Básico</dt>
            <dd className="mt-1 text-sm text-emerald-800">C3 · D1 · D2 · D3</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Nivel de cuidado sin registro UPC</h4>
        <p className="mt-1 text-sm text-slate-500">
          Distribución CUDYR de las observaciones que no tienen checklist ni marca UPC histórica.
        </p>
        <div className="mt-4">
          <CareLevelBar distribution={distribution} label="Todas las camas analizadas" />
        </div>
      </section>

      <UpcComparison groups={analysis.upcCareLevelsByClinicalCriteria} />
      <BedGroupComparison groups={analysis.nonUpcCareLevelsByBedGroup} />

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p>
          El denominador de cada porcentaje incluye solo observaciones con CUDYR completo. El nivel
          de cuidado describe complejidad y no reemplaza el criterio clínico UPC del programa HHR.
        </p>
      </div>
    </div>
  );
};
