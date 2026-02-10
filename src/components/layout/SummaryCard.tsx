import React from 'react';
import { Statistics, DischargeData, TransferData } from '@/types';
import { Activity, Bed, Baby } from 'lucide-react';

interface SummaryCardProps {
    stats: Statistics;
    discharges?: DischargeData[];
    transfers?: TransferData[];
    cmaCount?: number;
}

/**
 * Common Card Wrapper to maintain consistency with Nurse/Tens selectors
 */
const BaseSummaryCard: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
    <div className="card px-3 py-2 flex flex-col justify-between gap-2 hover:border-slate-300 transition-colors min-w-[140px] min-h-[88px] animate-fade-in">
        <div className="flex justify-between items-center pb-1 border-b border-slate-100">
            <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                {icon} {title}
            </label>
        </div>
        {children}
    </div>
);

export const BedSummaryCard: React.FC<{ stats: Statistics }> = ({ stats }) => {
    const capacidadServicio = stats.serviceCapacity - stats.blockedBeds;
    return (
        <BaseSummaryCard title="Censo Camas" icon={<Bed size={12} className="text-medical-500" />}>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <div className="flex justify-between items-center bg-slate-50/80 rounded px-1.5 py-0.5 border border-slate-100/50">
                    <span className="text-slate-500 text-[10px]">Ocu.</span>
                    <span className="font-bold text-medical-900 text-[11px]">{stats.occupiedBeds}</span>
                </div>
                <div className="flex justify-between items-center bg-medical-50 rounded px-1.5 py-0.5 border border-medical-100/50">
                    <span className="text-medical-700 font-bold text-[10px]">Cap:</span>
                    <span className="font-bold text-medical-900 text-[11px]">{capacidadServicio}</span>
                </div>
                <div className="flex justify-between items-center px-1.5">
                    <span className="text-red-500 font-medium text-[10px]">Bloq.</span>
                    <span className="font-bold text-red-600 text-[11px]">{stats.blockedBeds}</span>
                </div>
                <div className="flex justify-between items-center px-1.5">
                    <span className="text-slate-400 text-[10px]">Lib.</span>
                    <span className="font-bold text-slate-600 text-[11px]">{stats.availableCapacity}</span>
                </div>
            </div>
        </BaseSummaryCard>
    );
};

export const CribSummaryCard: React.FC<{ stats: Statistics }> = ({ stats }) => (
    <BaseSummaryCard title="Recursos Cuna" icon={<Baby size={12} className="text-medical-500" />}>
        <div className="space-y-1">
            <div className="flex justify-between items-center px-1">
                <span className="text-slate-500 text-[10px]">Clínicas</span>
                <span className="font-bold text-medical-600 text-[11px]">{stats.clinicalCribsCount}</span>
            </div>
            <div className="flex justify-between items-center px-1">
                <span className="text-slate-500 text-[10px]">RN Sano</span>
                <span className="font-bold text-green-600 text-[11px]">{stats.companionCribs}</span>
            </div>
            <div className="flex justify-between items-center mt-1 px-1 pt-1 border-t border-slate-200/50 border-dashed">
                <span className="text-medical-900 font-bold text-[10px]">Total Uso</span>
                <span className="font-bold text-medical-800 text-[11px] leading-none">{stats.totalCribsUsed}</span>
            </div>
        </div>
    </BaseSummaryCard>
);

export const MovementSummaryCard: React.FC<{ discharges: DischargeData[], transfers: TransferData[], cmaCount: number }> = ({ discharges, transfers, cmaCount }) => {
    const deaths = discharges.filter(d => d.status === 'Fallecido').length;
    const totalDischarges = discharges.length; // Total egresos (altas + fallecidos)
    const totalTransfers = transfers.length;

    return (
        <BaseSummaryCard title="Movimientos" icon={<Activity size={12} className="text-medical-500" />}>
            <div className="flex flex-col gap-1 px-1">
                <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-500 font-medium">Egresos</span>
                    <span className="font-bold text-green-600">{totalDischarges}</span>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-500 font-medium">Traslados</span>
                    <span className="font-bold text-blue-600">{totalTransfers}</span>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-500 font-medium">H. Diurna</span>
                    <span className="font-bold text-orange-600">{cmaCount}</span>
                </div>
                {deaths > 0 && (
                    <div className="flex justify-between items-center text-[10px] mt-0.5 pt-0.5 border-t border-red-100">
                        <span className="text-red-500 font-bold">Fallecidos</span>
                        <span className="font-bold text-red-600">{deaths}</span>
                    </div>
                )}
            </div>
        </BaseSummaryCard>
    );
};

/**
 * Legacy wrapper for backward compatibility, though we'll now prefer individual components
 */
export const SummaryCard: React.FC<SummaryCardProps> = ({ stats, discharges = [], transfers = [], cmaCount = 0 }) => {
    return (
        <CombinedSummaryCard stats={stats} discharges={discharges} transfers={transfers} cmaCount={cmaCount} />
    );
};

/**
 * Combined Summary Card - All stats sections in one unified card (compact 2-row)
 */
export const CombinedSummaryCard: React.FC<SummaryCardProps> = ({ stats, discharges = [], transfers = [], cmaCount = 0 }) => {
    const capacidadServicio = stats.serviceCapacity - stats.blockedBeds;
    const deaths = discharges.filter(d => d.status === 'Fallecido').length;
    const totalDischarges = discharges.length;
    const totalTransfers = transfers.length;

    return (
        <div className="card px-2 py-1.5 flex flex-row gap-0 hover:border-slate-300 transition-colors animate-fade-in">
            {/* Section 1: Censo Camas */}
            <div className="pr-3 flex flex-col gap-0.5">
                <div className="flex items-center gap-1 pb-0.5 border-b border-slate-100">
                    <Bed size={11} className="text-medical-500" />
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Censo Camas</span>
                </div>
                {/* Row 1: Ocu + Cap */}
                <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex items-center gap-1 bg-slate-50/80 rounded px-1.5 py-0.5 border border-slate-100/50">
                        <span className="text-slate-500 text-[9px]">Ocu.</span>
                        <span className="font-bold text-medical-900 text-[10px]">{stats.occupiedBeds}</span>
                    </div>
                    <div className="flex items-center gap-1 bg-medical-50 rounded px-1.5 py-0.5 border border-medical-100/50">
                        <span className="text-medical-700 font-bold text-[9px]">Cap:</span>
                        <span className="font-bold text-medical-900 text-[10px]">{capacidadServicio}</span>
                    </div>
                </div>
                {/* Row 2: Bloq + Lib */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 px-1.5 py-0.5 border border-transparent">
                        <span className="text-red-500 text-[9px]">Bloq.</span>
                        <span className="font-bold text-red-600 text-[10px]">{stats.blockedBeds}</span>
                    </div>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 border border-transparent">
                        <span className="text-slate-400 text-[9px]">Lib.</span>
                        <span className="font-bold text-slate-600 text-[10px]">{stats.availableCapacity}</span>
                    </div>
                </div>
            </div>

            {/* Vertical Separator */}
            <div className="w-px bg-slate-200 mx-1 self-stretch" />

            {/* Section 2: Recursos Cuna */}
            <div className="px-3 flex flex-col gap-0.5">
                <div className="flex items-center gap-1 pb-0.5 border-b border-slate-100">
                    <Baby size={11} className="text-medical-500" />
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Recursos Cuna</span>
                </div>
                {/* Row 1: Clínicas + RN Sano */}
                <div className="flex items-center gap-3 mt-0.5">
                    <div className="flex items-center gap-1">
                        <span className="text-slate-500 text-[9px]">Clínicas</span>
                        <span className="font-bold text-medical-600 text-[10px]">{stats.clinicalCribsCount}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <span className="text-slate-500 text-[9px]">RN Sano</span>
                        <span className="font-bold text-green-600 text-[10px]">{stats.companionCribs}</span>
                    </div>
                </div>
                {/* Row 2: Total */}
                <div className="flex items-center gap-1">
                    <span className="text-medical-900 font-bold text-[9px]">Total Uso</span>
                    <span className="font-bold text-medical-800 text-[10px]">{stats.totalCribsUsed}</span>
                </div>
            </div>

            {/* Vertical Separator */}
            <div className="w-px bg-slate-200 mx-1 self-stretch" />

            {/* Section 3: Movimientos */}
            <div className="pl-3 flex flex-col gap-0.5">
                <div className="flex items-center gap-1 pb-0.5 border-b border-slate-100">
                    <Activity size={11} className="text-medical-500" />
                    <span className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">Movimientos</span>
                </div>
                {/* Row 1: Egresos + Traslados */}
                <div className="flex items-center gap-3 mt-0.5">
                    <div className="flex items-center gap-1 text-[9px]">
                        <span className="text-slate-500">Egresos</span>
                        <span className="font-bold text-green-600 text-[10px]">{totalDischarges}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px]">
                        <span className="text-slate-500">Traslados</span>
                        <span className="font-bold text-blue-600 text-[10px]">{totalTransfers}</span>
                    </div>
                </div>
                {/* Row 2: H.Diurna + Fallecidos */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 text-[9px]">
                        <span className="text-slate-500">H.Diurna</span>
                        <span className="font-bold text-orange-600 text-[10px]">{cmaCount}</span>
                    </div>
                    {deaths > 0 && (
                        <div className="flex items-center gap-1 text-[9px]">
                            <span className="text-red-500 font-bold">Fall.</span>
                            <span className="font-bold text-red-600 text-[10px]">{deaths}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
