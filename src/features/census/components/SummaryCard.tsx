import React from 'react';
import type { Statistics } from '@/types/domain/statistics';
import { DischargeData, TransferData } from '@/types/domain/movements';
import { Activity, Bed } from 'lucide-react';
import { buildMovementSummaryModel } from '@/features/census/components/movementSummaryController';

interface SummaryCardProps {
  stats: Statistics;
  discharges?: DischargeData[];
  transfers?: TransferData[];
  cmaCount?: number;
  newAdmissions?: number;
}

/**
 * Legacy wrapper for backward compatibility, though we'll now prefer individual components
 */
export const SummaryCard: React.FC<SummaryCardProps> = ({
  stats,
  discharges = [],
  transfers = [],
  cmaCount = 0,
  newAdmissions = 0,
}) => {
  return (
    <CombinedSummaryCard
      stats={stats}
      discharges={discharges}
      transfers={transfers}
      cmaCount={cmaCount}
      newAdmissions={newAdmissions}
    />
  );
};

/**
 * Combined Summary Card - All stats sections in one unified card (compact 2-row)
 */
export const CombinedSummaryCard: React.FC<SummaryCardProps> = ({
  stats,
  discharges = [],
  transfers = [],
  cmaCount = 0,
  newAdmissions = 0,
}) => {
  const capacidadServicio = stats.serviceCapacity - stats.blockedBeds;
  const movementSummary = buildMovementSummaryModel(discharges, transfers, cmaCount, newAdmissions);

  return (
    <div className="census-toolbar-card flex min-h-20 self-stretch flex-row gap-0 tabular-nums text-[10px] leading-4 rounded-xl border border-slate-200/80 bg-white px-2.5 py-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 animate-fade-in">
      {/* Section 1: Censo Camas */}
      <div className="min-w-0 pr-1.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-1 pb-0.5 border-b border-slate-100">
          <Bed size={13} aria-hidden="true" className="text-accent-500" />
          <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
            Censo Camas
          </span>
        </div>
        {/* Row 1: Ocu + Cap */}
        <div className="flex items-center gap-1 mt-0.5">
          <div className="flex items-center gap-1 bg-slate-50/80 rounded px-1.5 py-0 border border-slate-100/50">
            <span className="text-slate-500 text-[10px]">Ocu.</span>
            <span className="font-bold text-accent-900 text-[11px]">{stats.occupiedBeds}</span>
          </div>
          <div className="flex items-center gap-1 bg-accent-50 rounded px-1.5 py-0 border border-accent-100/50">
            <span className="text-accent-700 font-bold text-[10px]">Cap:</span>
            <span className="font-bold text-accent-900 text-[11px]">{capacidadServicio}</span>
          </div>
        </div>
        {/* Row 2: Bloq + Lib */}
        <div className="flex flex-wrap items-center gap-x-1">
          <div className="flex items-center gap-1 px-1.5 py-0 border border-transparent">
            <span className="text-slate-500 text-[10px]">Bloq.</span>
            <span
              className={`font-bold text-[11px] ${stats.blockedBeds > 0 ? 'text-amber-700' : 'text-slate-700'}`}
            >
              {stats.blockedBeds}
            </span>
          </div>
          <div className="flex items-center gap-1 px-1.5 py-0 border border-transparent">
            <span className="text-slate-500 text-[10px]">Lib.</span>
            <span className="font-bold text-slate-600 text-[11px]">{stats.availableCapacity}</span>
          </div>
          <div className="flex items-center gap-1 px-1 py-0">
            <span className="text-slate-500 text-[10px]">Cunas</span>
            <span className="font-bold text-accent-800 text-[11px]">{stats.totalCribsUsed}</span>
          </div>
        </div>
      </div>

      {/* Vertical Separator */}
      <div className="w-px bg-slate-200/60 mx-1.5 self-stretch" />

      {/* Section 2: Movimientos */}
      <div className="min-w-0 pl-1.5 flex flex-col gap-0.5">
        <div className="flex items-center gap-1 pb-0.5 border-b border-slate-100">
          <Activity size={13} aria-hidden="true" className="text-accent-500" />
          <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
            Movimientos
          </span>
        </div>
        {/* Row 1: Altas + Traslados */}
        <div className="flex items-center gap-2 mt-0.5">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-500">Altas</span>
            <span className="font-bold text-slate-700 text-[11px]">
              {movementSummary.totalDischarges}
            </span>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-500">Traslados</span>
            <span className="font-bold text-slate-700 text-[11px]">
              {movementSummary.totalTransfers}
            </span>
          </div>
        </div>
        {/* Row 2: H.Diurna + Ingresos */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-500">H.Diurna</span>
            <span className="font-bold text-slate-700 text-[11px]">{movementSummary.cmaCount}</span>
          </div>
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-slate-500">Ingresos</span>
            <span className="font-bold text-accent-800 text-[11px]">
              {movementSummary.newAdmissions}
            </span>
          </div>
        </div>
        {/* Row 3: Fallecidos */}
        {movementSummary.totalDeaths > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-[10px]">
              <span className="text-red-500 font-bold">Fall.</span>
              <span className="font-bold text-red-600 text-[11px]">
                {movementSummary.totalDeaths}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
