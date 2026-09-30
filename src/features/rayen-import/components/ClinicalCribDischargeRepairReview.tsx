import type { ClinicalCribDischargeRepair } from '../contracts/censusImportDiff';
import { ddmmyyyy, Section } from './RayenImportDiffReviewParts';

export const ClinicalCribDischargeRepairReview = ({
  repairs = [],
}: {
  repairs?: readonly ClinicalCribDischargeRepair[];
}) => (
  <Section title="Corregir egresos RN duplicados" count={repairs.length}>
    {repairs.map(repair => (
      <li key={repair.duplicate.id}>
        <span className="font-semibold">{repair.kept.bedName}</span> — {repair.kept.patientName}:
        conservar un solo egreso del {ddmmyyyy(repair.kept.movementDate ?? '')} a las{' '}
        {repair.kept.time}.
        <p className="text-xs text-slate-500">
          La copia duplicada quedará archivada; se conserva el registro con ingreso y datos clínicos
          completos. No suma otro egreso.
        </p>
      </li>
    ))}
  </Section>
);
