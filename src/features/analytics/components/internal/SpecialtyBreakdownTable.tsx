import React from 'react';
import { MinsalStatistics, PatientTraceability, SpecialtyStats } from '@/types/minsalTypes';
import { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import {
  buildSpecialtyTraceability,
  SpecialtyTraceabilityType,
} from '@/services/calculations/minsalStatsCalculator';
import { TraceabilityModal } from './TraceabilityModal';
import {
  calculateStayAverageFromTraceability,
  formatStayRange,
  getSpecialtyEventCount,
  getSpecialtySortValue,
  type SpecialtyBreakdownSortKey,
} from '@/features/analytics/controllers/specialtyBreakdownTableController';
import { SpecialtyBreakdownSortHeader } from './SpecialtyBreakdownSortHeader';
import { SpecialtyBreakdownTotalRow } from './SpecialtyBreakdownTotalRow';
import { SpecialtyBreakdownToolbar } from './SpecialtyBreakdownToolbar';

interface SpecialtyBreakdownTableProps {
  data: SpecialtyStats[];
  records?: DailyRecord[];
  summary?: MinsalStatistics;
  onOpenCensusDate?: (date: string) => void;
}

const TRACEABILITY_TITLE_BY_TYPE: Record<SpecialtyTraceabilityType, string> = {
  'dias-cama': 'Días Cama',
  egresos: 'Egresos',
  fallecidos: 'Fallecidos',
  traslados: 'Traslados',
  cma: 'CMA/PMA',
  aerocardal: 'Aerocardal',
  fach: 'FACH',
  estada: 'Estada de egresos',
};

export const SpecialtyBreakdownTable: React.FC<SpecialtyBreakdownTableProps> = ({
  data = [],
  records = [],
  summary,
  onOpenCensusDate,
}) => {
  const [modalConfig, setModalConfig] = React.useState<{
    isOpen: boolean;
    title: string;
    patients: PatientTraceability[];
    type: SpecialtyTraceabilityType;
  }>({
    isOpen: false,
    title: '',
    patients: [],
    type: 'dias-cama',
  });
  const [sortKey, setSortKey] = React.useState<SpecialtyBreakdownSortKey>('diasOcupados');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc');
  const [onlyRowsWithEvents, setOnlyRowsWithEvents] = React.useState(false);

  const handleOpenTraceability = (
    specialty: string,
    type: SpecialtyTraceabilityType,
    patients: PatientTraceability[] = []
  ) => {
    const resolvedPatients =
      patients.length > 0 ? patients : buildSpecialtyTraceability(records, specialty, type);
    setModalConfig({
      isOpen: true,
      title: `Detalle: ${TRACEABILITY_TITLE_BY_TYPE[type]} - ${specialty}`,
      patients: resolvedPatients,
      type,
    });
  };

  const handleSort = (nextSortKey: SpecialtyBreakdownSortKey) => {
    if (sortKey === nextSortKey) {
      setSortDirection(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === 'specialty' ? 'asc' : 'desc');
  };

  const visibleRows = React.useMemo(() => {
    const rows = onlyRowsWithEvents ? data.filter(row => getSpecialtyEventCount(row) > 0) : data;
    return [...rows].sort((a, b) => {
      const left = getSpecialtySortValue(a, sortKey);
      const right = getSpecialtySortValue(b, sortKey);
      const comparison =
        typeof left === 'string' || typeof right === 'string'
          ? String(left).localeCompare(String(right))
          : left - right;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, onlyRowsWithEvents, sortDirection, sortKey]);

  const sortHeaderProps = { sortKey, sortDirection, onSort: handleSort };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400">
        No hay datos de especialidades para el período seleccionado.
      </div>
    );
  }

  const totalEgresos = data.reduce((sum, row) => sum + (row.egresos ?? 0), 0);
  const totalFallecidos = data.reduce((sum, row) => sum + (row.fallecidos ?? 0), 0);
  const totalTraslados = data.reduce((sum, row) => sum + (row.traslados ?? 0), 0);
  const totalAerocardal = data.reduce((sum, row) => sum + (row.aerocardal ?? 0), 0);
  const totalFach = data.reduce((sum, row) => sum + (row.fach ?? 0), 0);
  const totalPacientesActuales =
    summary?.pacientesActuales ?? data.reduce((sum, row) => sum + (row.pacientesActuales ?? 0), 0);
  const totalEgresosConTraslados = totalEgresos + totalTraslados;
  const totalPromedioDiasEstada =
    summary?.promedioDiasEstada ?? calculateStayAverageFromTraceability(data);
  const totalMortalidad =
    summary?.mortalidadHospitalaria ??
    (totalEgresosConTraslados > 0 ? (totalFallecidos / totalEgresosConTraslados) * 100 : 0);
  const totalRange = formatStayRange(
    summary?.promedioDiasEstadaMinima,
    summary?.promedioDiasEstadaMaxima
  );

  return (
    <div className="space-y-3">
      <SpecialtyBreakdownToolbar
        onlyRowsWithEvents={onlyRowsWithEvents}
        onToggleRowsWithEvents={() => setOnlyRowsWithEvents(current => !current)}
      />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-100">
              <th className="sticky left-0 z-20 bg-slate-100 text-left px-4 py-3 font-semibold text-slate-700 rounded-tl-lg">
                <SpecialtyBreakdownSortHeader
                  label="Especialidad"
                  column="specialty"
                  className="justify-start"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                <SpecialtyBreakdownSortHeader
                  label="Días-cama del período"
                  column="diasOcupados"
                  ariaLabel="días-cama"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                <SpecialtyBreakdownSortHeader
                  label="Egresos del período"
                  column="egresos"
                  ariaLabel="egresos"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                <SpecialtyBreakdownSortHeader
                  label="Fallecidos del período"
                  column="fallecidos"
                  ariaLabel="fallecidos"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                <SpecialtyBreakdownSortHeader
                  label="Traslados del período"
                  column="traslados"
                  ariaLabel="traslados"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                Aerocardal del período
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                FACH del período
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                Contribución del período
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                <SpecialtyBreakdownSortHeader
                  label="Mortalidad del período"
                  column="tasaMortalidad"
                  ariaLabel="mortalidad"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700">
                <SpecialtyBreakdownSortHeader
                  label="Estada media de egresos"
                  column="promedioDiasEstada"
                  ariaLabel="estada"
                  {...sortHeaderProps}
                />
              </th>
              <th className="text-center px-4 py-3 font-semibold text-slate-700 rounded-tr-lg">
                Rango estada egresos
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => {
              const egresos = row.egresos ?? 0;
              const fallecidos = row.fallecidos ?? 0;
              const traslados = row.traslados ?? 0;
              const aerocardal = row.aerocardal ?? 0;
              const fach = row.fach ?? 0;
              return (
                <tr
                  key={row.specialty}
                  className={`border-b border-slate-100 ${
                    index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                  } hover:bg-sky-50 transition-colors`}
                >
                  <td className="sticky left-0 z-10 bg-inherit px-4 py-3 font-medium text-slate-800">
                    {row.specialty || 'Sin Especialidad'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() =>
                        handleOpenTraceability(
                          String(row.specialty),
                          'dias-cama',
                          row.diasOcupadosList
                        )
                      }
                      className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 bg-sky-100 text-sky-700 rounded-full font-semibold hover:bg-sky-200 transition-colors cursor-pointer"
                      title="Ver detalle de pacientes"
                    >
                      {row.diasOcupados}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() =>
                        handleOpenTraceability(String(row.specialty), 'egresos', row.egresosList)
                      }
                      className={`font-medium hover:underline cursor-pointer ${
                        egresos > 0 ? 'text-slate-700' : 'text-slate-400'
                      }`}
                      disabled={egresos === 0}
                    >
                      {egresos}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() =>
                        handleOpenTraceability(
                          String(row.specialty),
                          'fallecidos',
                          row.fallecidosList
                        )
                      }
                      className={`font-medium hover:underline cursor-pointer ${
                        fallecidos > 0 ? 'text-red-600' : 'text-slate-400'
                      }`}
                      disabled={fallecidos === 0}
                    >
                      {fallecidos}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() =>
                        handleOpenTraceability(
                          String(row.specialty),
                          'traslados',
                          row.trasladosList
                        )
                      }
                      className={`font-medium hover:underline cursor-pointer ${
                        traslados > 0 ? 'text-amber-600' : 'text-slate-400'
                      }`}
                      disabled={traslados === 0}
                    >
                      {traslados}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() =>
                        handleOpenTraceability(
                          String(row.specialty),
                          'aerocardal',
                          row.aerocardalList
                        )
                      }
                      className={`font-medium hover:underline cursor-pointer ${
                        aerocardal > 0 ? 'text-cyan-700' : 'text-slate-400'
                      }`}
                      disabled={aerocardal === 0}
                      title="Ver detalle Aerocardal"
                    >
                      {aerocardal}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() =>
                        handleOpenTraceability(String(row.specialty), 'fach', row.fachList)
                      }
                      className={`font-medium hover:underline cursor-pointer ${
                        fach > 0 ? 'text-indigo-700' : 'text-slate-400'
                      }`}
                      disabled={fach === 0}
                      title="Ver detalle FACH"
                    >
                      {fach}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-sky-500 rounded-full"
                          style={{ width: `${Math.min(row.contribucionRelativa, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-slate-600 min-w-[3rem]">
                        {row.contribucionRelativa.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`font-medium ${
                        row.tasaMortalidad > 5
                          ? 'text-red-600'
                          : row.tasaMortalidad > 0
                            ? 'text-orange-600'
                            : 'text-slate-400'
                      }`}
                    >
                      {row.tasaMortalidad.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">
                    {row.promedioDiasEstada.toFixed(2)} días
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenTraceability(String(row.specialty), 'estada', row.egresosList)
                      }
                      className="hover:underline cursor-pointer"
                      aria-label={`Ver casos de estada de ${row.specialty || 'Sin Especialidad'}`}
                      title="Ver casos que componen el rango de estada"
                    >
                      {formatStayRange(row.promedioDiasEstadaMinima, row.promedioDiasEstadaMaxima)}
                    </button>
                  </td>
                </tr>
              );
            })}
            <SpecialtyBreakdownTotalRow
              totalPacientesActuales={totalPacientesActuales}
              totalEgresos={totalEgresos}
              totalFallecidos={totalFallecidos}
              totalTraslados={totalTraslados}
              totalAerocardal={totalAerocardal}
              totalFach={totalFach}
              totalMortalidad={totalMortalidad}
              totalPromedioDiasEstada={totalPromedioDiasEstada}
              totalRange={totalRange}
            />
          </tbody>
        </table>
      </div>

      <TraceabilityModal
        isOpen={modalConfig.isOpen}
        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        title={modalConfig.title}
        patients={modalConfig.patients}
        type={modalConfig.type}
        onOpenCensusDate={onOpenCensusDate}
      />
    </div>
  );
};

export default SpecialtyBreakdownTable;
