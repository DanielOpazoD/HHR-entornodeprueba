import React from 'react';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import { resolveUpcClassification } from '@/domain/upc/upcClassification';
import { UpcChecklistPanel } from './UpcChecklistPanel';
import { UpcEvaluationHistoryPanel } from './UpcEvaluationHistoryPanel';
import type { UpcClassificationRow } from './upcClassificationWindowModel';

interface UpcBedCriteriaDraftPanelProps {
  row: UpcClassificationRow;
  patient: PatientData;
  criteria: { uci: string[]; uti: string[] };
  readOnly: boolean;
  saving?: boolean;
  date: string;
  onToggleUci: (id: string) => void;
  onToggleUti: (id: string) => void;
  onClose: () => void;
}

/**
 * Criteria editor of the day panel: the same checklist and history as the census, but the draft
 * lives in the window and is signed once with «Confirmar cambios» — no nurse field or per-bed save.
 */
export const UpcBedCriteriaDraftPanel: React.FC<UpcBedCriteriaDraftPanelProps> = ({
  row,
  patient,
  criteria,
  readOnly,
  saving = false,
  date,
  onToggleUci,
  onToggleUti,
  onClose,
}) => {
  const uci = new Set(criteria.uci);
  const uti = new Set(criteria.uti);

  return (
    <UpcChecklistPanel
      bedId={row.bedName}
      readOnly={readOnly}
      saving={saving}
      draftUci={uci}
      draftUti={uti}
      draftClassification={resolveUpcClassification({ uciCriteria: uci, utiCriteria: uti })}
      hasDraftCriteria={uci.size > 0 || uti.size > 0}
      uciAllowed={row.uciAllowed}
      onToggleUci={onToggleUci}
      onToggleUti={onToggleUti}
      onClose={onClose}
      historyContent={<UpcEvaluationHistoryPanel patient={patient} date={date} />}
    />
  );
};
