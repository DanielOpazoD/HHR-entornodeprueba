import React, { Suspense, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { DataMaintenancePanel } from './internal/DataMaintenancePanel';
import { AlertTriangle, Database, History } from 'lucide-react';
import { useCensusContext } from '@/context/CensusContext';
import { canUseAdminMaintenanceActions } from '@/shared/access/operationalAccessPolicy';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';

const DailyRecordRestorePanel = lazyWithRetry(() =>
  import('./DailyRecordRestorePanel').then(module => ({ default: module.DailyRecordRestorePanel }))
);
const InvalidClinicalEpisodesPanel = lazyWithRetry(() =>
  import('./InvalidClinicalEpisodesPanel').then(module => ({
    default: module.InvalidClinicalEpisodesPanel,
  }))
);

export const DataMaintenanceView: React.FC = () => {
  const { currentUser } = useAuth();
  const canUseAdminMaintenance = canUseAdminMaintenanceActions(currentUser?.role);
  const [showRestore, setShowRestore] = useState(false);
  const [showInvalidEpisodes, setShowInvalidEpisodes] = useState(false);
  const { fileOps } = useCensusContext();

  return (
    <div className="max-w-[1200px] mx-auto p-4 animate-fade-in font-sans pb-16">
      <div className="bg-emerald-900 rounded-2xl p-5 mb-6 text-white relative overflow-hidden shadow-xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
            <Database size={24} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight leading-none mb-1">
              Mantenimiento y Respaldos
            </h1>
            <p className="text-[11px] text-emerald-200/60 font-medium">
              Gestión de integridad y seguridad de datos
            </p>
          </div>
        </div>
      </div>

      {canUseAdminMaintenance && (
        <div className="mb-6 space-y-4">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              onClick={() => setShowRestore(value => !value)}
            >
              <History size={16} className="text-emerald-700" aria-hidden="true" />
              {showRestore ? 'Cerrar restauración' : 'Abrir restauración de un día'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
              onClick={() => setShowInvalidEpisodes(value => !value)}
            >
              <AlertTriangle size={16} className="text-amber-600" aria-hidden="true" />
              {showInvalidEpisodes ? 'Cerrar pacientes no válidos' : 'Ver pacientes no válidos'}
            </button>
          </div>
          {showRestore && (
            <Suspense fallback={<p className="text-sm text-slate-500">Cargando restauración…</p>}>
              <DailyRecordRestorePanel />
            </Suspense>
          )}
          {showInvalidEpisodes && (
            <Suspense
              fallback={<p className="text-sm text-slate-500">Cargando pacientes no válidos…</p>}
            >
              <InvalidClinicalEpisodesPanel />
            </Suspense>
          )}
        </div>
      )}
      <DataMaintenancePanel
        onDailyExport={fileOps.handleExportJSON}
        onDailyImport={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = e => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files[0]) {
              void fileOps.handleImportFile(target.files[0]);
            }
          };
          input.click();
        }}
      />
    </div>
  );
};
