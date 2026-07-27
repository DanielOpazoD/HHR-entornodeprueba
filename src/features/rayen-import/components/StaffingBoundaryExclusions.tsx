import React from 'react';
import type {
  NursingBoundaryExclusion,
  NursingActivitySource,
} from '../contracts/nursingShiftInference';
import type { RayenStaffingBoundaryExclusion } from '@/types/domain/rayenSync';

type BoundaryEvidence = NursingBoundaryExclusion | RayenStaffingBoundaryExclusion;

const SOURCE_LABELS: Record<NursingActivitySource, string> = {
  evolution: 'Evolución',
  'shift-change': 'Entrega de turno',
  'evaluation-scale': 'Escala',
  'medication-administration': 'Medicamento',
  'vital-signs': 'Signos vitales',
};

const SECTION_LABELS = {
  nurse_day: 'Enfermería · día',
  nurse_night: 'Enfermería · noche',
  tens_day: 'TENS · largo',
  tens_night: 'TENS · noche',
} as const;

const BOUNDARY_REASON = {
  day_start: 'primeros 60 min del turno día',
  night_start: 'primeros 60 min del turno noche',
  night_end: '60 min posteriores al cierre del turno noche',
} as const;

const formatLocalStamp = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!match) return value;
  return `${match[3]}-${match[2]} ${match[4].padStart(2, '0')}:${match[5]}`;
};

const hasSection = (value: BoundaryEvidence): value is RayenStaffingBoundaryExclusion =>
  'section' in value;

export const StaffingBoundaryExclusions: React.FC<{
  evidence: BoundaryEvidence[];
  total: number;
}> = ({ evidence, total }) => {
  if (total === 0) return null;
  return (
    <details className="mt-2 rounded-lg border border-amber-200 bg-white/60 px-2.5 py-2">
      <summary className="cursor-pointer font-semibold text-amber-900">
        Ver quiénes fueron excluidos ({total})
      </summary>
      {evidence.length > 0 ? (
        <>
          {evidence.length < total && (
            <p className="mt-2 text-[11px] text-amber-800">
              Se muestran {evidence.length} firmas distintas; el total incluye acciones repetidas en
              diferentes fichas.
            </p>
          )}
          <ul className="mt-2 space-y-1.5" aria-label="Registros excluidos cerca del relevo">
            {evidence.map(item => (
              <li
                key={`${hasSection(item) ? item.section : 'proposal'}-${item.name}-${item.recordedAt}-${item.source}-${item.boundary}`}
                className="rounded-md border border-amber-100 bg-white px-2 py-1.5 text-[11px] text-slate-700"
              >
                <p className="font-semibold text-slate-800">
                  {item.name} · {formatLocalStamp(item.recordedAt)}
                </p>
                <p>
                  {hasSection(item) ? `${SECTION_LABELS[item.section]} · ` : ''}
                  {item.role} · {SOURCE_LABELS[item.source]}
                </p>
                <p className="text-amber-800">Motivo: {BOUNDARY_REASON[item.boundary]}.</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-[11px] text-amber-800">
          Esta sincronización fue registrada por una versión anterior y solo conservó el total.
          Ejecuta una nueva sincronización para obtener nombres y horarios.
        </p>
      )}
    </details>
  );
};
