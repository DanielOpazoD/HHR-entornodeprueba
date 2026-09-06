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

type BoundaryEvidenceTone = 'neutral' | 'warning';

const formatLocalStamp = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!match) return value;
  return `${match[3]}-${match[2]} ${match[4].padStart(2, '0')}:${match[5]}`;
};

const hasSection = (value: BoundaryEvidence): value is RayenStaffingBoundaryExclusion =>
  'section' in value;

const evidenceKey = (item: BoundaryEvidence): string =>
  `${hasSection(item) ? item.section : 'proposal'}-${item.name}-${item.role}-${item.recordedAt}-${item.source}-${item.boundary}`;

export const StaffingBoundaryExclusions: React.FC<{
  evidence: BoundaryEvidence[];
  total: number;
  tone?: BoundaryEvidenceTone;
  embedded?: boolean;
}> = ({ evidence, total, tone = 'neutral', embedded = false }) => {
  if (total === 0) return null;
  const uniqueEvidence = [...new Map(evidence.map(item => [evidenceKey(item), item])).values()];
  const palette =
    tone === 'warning'
      ? {
          container: 'border-amber-200 bg-white/60',
          summary: 'text-amber-900',
          note: 'text-amber-800',
          item: 'border-amber-100',
          reason: 'text-amber-800',
        }
      : {
          container: 'border-slate-200 bg-white/70',
          summary: 'text-slate-700',
          note: 'text-slate-500',
          item: 'border-slate-200',
          reason: 'text-slate-500',
        };
  const Container = embedded ? 'div' : 'details';
  return (
    <Container
      className={embedded ? 'mt-2' : `mt-2 rounded-lg border px-2.5 py-2 ${palette.container}`}
    >
      {!embedded && (
        <summary className={`cursor-pointer font-semibold ${palette.summary}`}>
          Ver actividad cercana al relevo ({total})
        </summary>
      )}
      {uniqueEvidence.length > 0 ? (
        <>
          {uniqueEvidence.length < total && (
            <p className={`mt-2 text-[11px] ${palette.note}`}>
              Se muestran {uniqueEvidence.length} firmas únicas disponibles. El total también puede
              incluir acciones repetidas o detalles omitidos por el límite del historial.
            </p>
          )}
          <ul className="mt-2 space-y-1.5" aria-label="Actividad registrada cerca del relevo">
            {uniqueEvidence.map(item => (
              <li
                key={evidenceKey(item)}
                className={`rounded-md border bg-white px-2 py-1.5 text-[11px] text-slate-700 ${palette.item}`}
              >
                <p className="font-semibold text-slate-800">
                  {item.name} · {formatLocalStamp(item.recordedAt)}
                </p>
                <p>
                  {hasSection(item) ? `${SECTION_LABELS[item.section]} · ` : ''}
                  {item.role} · {SOURCE_LABELS[item.source]}
                </p>
                <p className={palette.reason}>
                  Ventana de relevo: {BOUNDARY_REASON[item.boundary]}.
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={`mt-2 text-[11px] ${palette.note}`}>
          Esta sincronización fue registrada por una versión anterior y solo conservó el total.
          Ejecuta una nueva sincronización para obtener nombres y horarios.
        </p>
      )}
    </Container>
  );
};
