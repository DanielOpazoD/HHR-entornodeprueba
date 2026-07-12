import React from 'react';
import { ExternalLink, Info } from 'lucide-react';

import type {
  MinsalCudyrBedGroupDistribution,
  MinsalCudyrDistribution,
} from '@/features/analytics/controllers/cudyrMinsalEquivalenceController';
import type {
  CudyrUpcAnalysis,
  HhrUpcMinsalDistribution,
} from '@/features/analytics/controllers/cudyrUpcAnalysisController';

interface CudyrMinsalEquivalenceChartsProps {
  analysis: CudyrUpcAnalysis;
}

interface DistributionBarProps {
  distribution: MinsalCudyrDistribution;
  label: string;
}

const MINSAL_GUIDE_URL =
  'https://plandeinversionesensalud.minsal.cl/wp-content/uploads/2022/12/D303.-HAC-Guia-Hospitales-Unidad-Pacientes-Criticos-UPC-2022.pdf';

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const DistributionBar: React.FC<DistributionBarProps> = ({ distribution, label }) => {
  const hasCategorizedData = distribution.categorizedObservations > 0;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="text-xs tabular-nums text-slate-500">
          {distribution.categorizedObservations} CUDYR completos
        </span>
      </div>
      <div
        className="flex h-7 overflow-hidden rounded-md bg-slate-100"
        role="img"
        aria-label={`${label}: ${formatPercent(distribution.uciPercent)} equivalente UCI, ${formatPercent(distribution.utiPercent)} equivalente UTI y ${formatPercent(distribution.nonUpcPercent)} no equivalente a UPC`}
      >
        {hasCategorizedData ? (
          <>
            <div
              className="flex items-center justify-center bg-rose-500 text-[10px] font-bold text-white"
              style={{ width: `${distribution.uciPercent}%` }}
              title={`Equivalente UCI: ${distribution.uciEquivalent}`}
            >
              {distribution.uciPercent >= 18
                ? `${distribution.uciEquivalent} · ${formatPercent(distribution.uciPercent)}`
                : ''}
            </div>
            <div
              className="flex items-center justify-center bg-amber-400 text-[10px] font-bold text-amber-950"
              style={{ width: `${distribution.utiPercent}%` }}
              title={`Equivalente UTI: ${distribution.utiEquivalent}`}
            >
              {distribution.utiPercent >= 18
                ? `${distribution.utiEquivalent} · ${formatPercent(distribution.utiPercent)}`
                : ''}
            </div>
            <div
              className="flex items-center justify-center bg-sky-500 text-[10px] font-bold text-white"
              style={{ width: `${distribution.nonUpcPercent}%` }}
              title={`No equivalente a UPC: ${distribution.nonUpcEquivalent}`}
            >
              {distribution.nonUpcPercent >= 18
                ? `${distribution.nonUpcEquivalent} · ${formatPercent(distribution.nonUpcPercent)}`
                : ''}
            </div>
          </>
        ) : (
          <div className="flex w-full items-center justify-center text-[10px] font-medium text-slate-400">
            Sin CUDYR completo
          </div>
        )}
      </div>
      <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-3">
        <span className="flex items-center gap-1.5 text-rose-800">
          <span className="h-2 w-2 rounded-full bg-rose-500" /> UCI:{' '}
          <strong className="tabular-nums">
            {distribution.uciEquivalent} ({formatPercent(distribution.uciPercent)})
          </strong>
        </span>
        <span className="flex items-center gap-1.5 text-amber-900">
          <span className="h-2 w-2 rounded-full bg-amber-400" /> UTI:{' '}
          <strong className="tabular-nums">
            {distribution.utiEquivalent} ({formatPercent(distribution.utiPercent)})
          </strong>
        </span>
        <span className="flex items-center gap-1.5 text-sky-800">
          <span className="h-2 w-2 rounded-full bg-sky-500" /> No UPC:{' '}
          <strong className="tabular-nums">
            {distribution.nonUpcEquivalent} ({formatPercent(distribution.nonUpcPercent)})
          </strong>
        </span>
      </div>
      {distribution.missingCudyr > 0 ? (
        <p className="mt-1 text-[11px] text-slate-500">
          {distribution.missingCudyr} observaciones sin CUDYR, excluidas del porcentaje.
        </p>
      ) : null}
    </div>
  );
};

const BedGroupComparison: React.FC<{
  groups: MinsalCudyrBedGroupDistribution[];
}> = ({ groups }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h4 className="font-bold text-slate-800">Equivalencia por ubicación de cama</h4>
    <p className="mt-1 text-sm text-slate-500">
      Compara camas básicas, potencialmente UTI y neonatales sin criterio UPC HHR.
    </p>
    <div className="mt-5 space-y-5">
      {groups.map(group => (
        <DistributionBar key={group.key} distribution={group} label={group.label} />
      ))}
    </div>
  </div>
);

const ClinicalCriteriaComparison: React.FC<{
  groups: HhrUpcMinsalDistribution[];
}> = ({ groups }) => (
  <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm">
    <h4 className="font-bold text-slate-800">
      Criterio clínico HHR versus equivalencia CUDYR/MINSAL
    </h4>
    <p className="mt-1 text-sm leading-relaxed text-slate-500">
      Muestra qué complejidad CUDYR presentan específicamente los pacientes que el programa calificó
      como UPC–UCI o UPC–UTI mediante checklist clínico.
    </p>
    <div className="mt-5 space-y-6">
      {groups.map(group => (
        <DistributionBar key={group.key} distribution={group} label={group.label} />
      ))}
    </div>
  </div>
);

export const CudyrMinsalEquivalenceCharts: React.FC<CudyrMinsalEquivalenceChartsProps> = ({
  analysis,
}) => {
  const distribution = analysis.nonHhrUpcMinsal;

  return (
    <div className="space-y-4" data-testid="cudyr-minsal-equivalence">
      <div className="rounded-xl border border-orange-200 bg-orange-50 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="font-bold text-slate-800">Equivalencia CUDYR/MINSAL para UPC</h4>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              En hospitales de alta complejidad, MINSAL asocia A1, A2 y B1 a UCI; A3, B2 y también
              B1 a UTI. Para obtener porcentajes excluyentes que sumen 100%, este análisis asigna B1
              a UCI por precedencia de mayor complejidad. Las demás categorías se muestran como no
              equivalentes a UPC.
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-orange-300 bg-white text-sm">
            <div className="border-b border-r border-orange-200 bg-orange-200 px-3 py-2 font-bold text-orange-950">
              UCI
            </div>
            <div className="border-b border-orange-200 px-4 py-2 font-semibold text-slate-700">
              A1 · A2 · B1
            </div>
            <div className="border-r border-orange-200 bg-amber-100 px-3 py-2 font-bold text-amber-950">
              UTI
            </div>
            <div className="px-4 py-2 font-semibold text-slate-700">A3 · B2 · B1</div>
          </div>
        </div>
        <a
          className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-orange-800 underline decoration-orange-300 underline-offset-2 hover:text-orange-950"
          href={MINSAL_GUIDE_URL}
          target="_blank"
          rel="noreferrer"
        >
          Guía oficial MINSAL de UPC hospitalaria
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-800">
            Equivalente UCI
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-rose-800">
            {formatPercent(distribution.uciPercent)}
          </div>
          <p className="mt-1 text-xs text-rose-700">
            {distribution.uciEquivalent} de {distribution.categorizedObservations} observaciones
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
            Equivalente UTI
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-amber-900">
            {formatPercent(distribution.utiPercent)}
          </div>
          <p className="mt-1 text-xs text-amber-800">
            {distribution.utiEquivalent} de {distribution.categorizedObservations} observaciones
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-800">
            No equivalente a UPC
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-sky-800">
            {formatPercent(distribution.nonUpcPercent)}
          </div>
          <p className="mt-1 text-xs text-sky-700">
            {distribution.nonUpcEquivalent} de {distribution.categorizedObservations} observaciones
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Pacientes sin criterio UPC HHR</h4>
        <p className="mt-1 text-sm text-slate-500">
          Distribución porcentual según equivalencia CUDYR/MINSAL durante el período seleccionado.
        </p>
        <div className="mt-5">
          <DistributionBar distribution={distribution} label="Todas las camas analizadas" />
        </div>
      </div>

      <ClinicalCriteriaComparison groups={analysis.hhrUpcMinsalByClinicalCriteria} />

      <BedGroupComparison groups={analysis.nonHhrUpcMinsalByBedGroup} />

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p>
          Cada barra usa como denominador las observaciones paciente-noche con CUDYR completo del
          grupo indicado; los CUDYR incompletos se informan y se excluyen del porcentaje. Los
          registros UPC históricos sin desglose no se mezclan con los grupos clínicos UTI/UCI. La
          equivalencia ministerial describe complejidad de cuidados y no reemplaza la evaluación
          clínica UPC del programa HHR.
        </p>
      </div>
    </div>
  );
};
