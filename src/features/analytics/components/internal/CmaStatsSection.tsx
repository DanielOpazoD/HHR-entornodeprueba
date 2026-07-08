import React from 'react';
import { Activity, ClipboardList } from 'lucide-react';
import type { CmaStatistics, PatientTraceability } from '@/types/minsalTypes';
import { TraceabilityModal } from './TraceabilityModal';

interface CmaStatsSectionProps {
  cma?: CmaStatistics;
  onOpenCensusDate?: (date: string) => void;
}

const formatNumber = (value: number | undefined): number => value ?? 0;

const filterByIntervention = (
  rows: PatientTraceability[],
  interventionType: 'Cirugía Mayor Ambulatoria' | 'Procedimiento Médico Ambulatorio'
): PatientTraceability[] => rows.filter(row => row.interventionType === interventionType);

export const CmaStatsSection: React.FC<CmaStatsSectionProps> = ({ cma, onOpenCensusDate }) => {
  const specialtyRows = cma?.porEspecialidad ?? [];
  const [modalConfig, setModalConfig] = React.useState<{
    title: string;
    patients: PatientTraceability[];
  } | null>(null);
  const allPatients = cma?.pacientesList ?? [];
  const openTraceability = React.useCallback((title: string, patients: PatientTraceability[]) => {
    setModalConfig({
      title,
      patients,
    });
  }, []);

  return (
    <section className="bg-white p-5 rounded-lg shadow-sm border border-slate-200">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-slate-700 flex items-center gap-2">
            <Activity className="w-5 h-5 text-teal-600" />
            CMA / Hospitalización diurna
          </h3>
        </div>
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-3 py-1.5 rounded-lg">
          <ClipboardList className="w-4 h-4" />
          {formatNumber(cma?.total)} eventos
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-colors hover:border-slate-300 hover:bg-white"
          aria-label="Ver detalle total CMA/PMA"
          onClick={() => openTraceability('Detalle: CMA/PMA', allPatients)}
        >
          <div className="text-2xl font-bold text-slate-800">{formatNumber(cma?.total)}</div>
          <div className="text-sm text-slate-600">Eventos CMA/PMA</div>
        </button>
        <button
          type="button"
          className="rounded-lg border border-teal-100 bg-teal-50 px-4 py-3 text-left transition-colors hover:border-teal-200 hover:bg-white"
          aria-label="Ver detalle CMA"
          onClick={() =>
            openTraceability(
              'Detalle: CMA',
              filterByIntervention(allPatients, 'Cirugía Mayor Ambulatoria')
            )
          }
        >
          <div className="text-2xl font-bold text-teal-700">
            {formatNumber(cma?.cirugiaMayorAmbulatoria)}
          </div>
          <div className="text-sm text-teal-800">Cirugía Mayor Ambulatoria</div>
        </button>
        <button
          type="button"
          className="rounded-lg border border-cyan-100 bg-cyan-50 px-4 py-3 text-left transition-colors hover:border-cyan-200 hover:bg-white"
          aria-label="Ver detalle PMA"
          onClick={() =>
            openTraceability(
              'Detalle: PMA',
              filterByIntervention(allPatients, 'Procedimiento Médico Ambulatorio')
            )
          }
        >
          <div className="text-2xl font-bold text-cyan-700">
            {formatNumber(cma?.procedimientoMedicoAmbulatorio)}
          </div>
          <div className="text-sm text-cyan-800">Procedimiento Médico Ambulatorio</div>
        </button>
      </div>

      {specialtyRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="text-left px-4 py-2 font-semibold text-slate-700 rounded-tl-lg">
                  Especialidad
                </th>
                <th className="text-center px-4 py-2 font-semibold text-slate-700">Total</th>
                <th className="text-center px-4 py-2 font-semibold text-slate-700">CMA</th>
                <th className="text-center px-4 py-2 font-semibold text-slate-700 rounded-tr-lg">
                  PMA
                </th>
              </tr>
            </thead>
            <tbody>
              {specialtyRows.map(row => (
                <tr key={String(row.specialty)} className="border-b border-slate-100">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-800">
                    <button
                      type="button"
                      className="font-semibold text-slate-800 hover:text-sky-700 hover:underline"
                      onClick={() =>
                        openTraceability(
                          `Detalle: CMA/PMA - ${row.specialty || 'Sin Especialidad'}`,
                          row.pacientesList ?? []
                        )
                      }
                    >
                      {row.specialty || 'Sin Especialidad'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-center text-slate-700">{row.total}</td>
                  <td className="px-4 py-2 text-center text-teal-700">
                    {row.cirugiaMayorAmbulatoria}
                  </td>
                  <td className="px-4 py-2 text-center text-cyan-700">
                    {row.procedimientoMedicoAmbulatorio}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-4 text-sm text-slate-400">
          Sin eventos CMA/PMA en el período seleccionado.
        </div>
      )}

      <TraceabilityModal
        isOpen={modalConfig !== null}
        onClose={() => setModalConfig(null)}
        title={modalConfig?.title ?? ''}
        patients={modalConfig?.patients ?? []}
        type="cma"
        onOpenCensusDate={onOpenCensusDate}
      />
    </section>
  );
};

export default CmaStatsSection;
