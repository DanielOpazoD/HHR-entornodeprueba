import React from 'react';
import { FileText } from 'lucide-react';
import { MOVEMENT_ACTION_BUTTON_CLASS } from './censusMovementActionPresentation';

export const CensusMovementEpicrisisButton: React.FC<{
  patientName: string;
  onClick: () => void;
}> = ({ patientName, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Ver epicrisis de ${patientName}`}
    title="Consultar epicrisis en Eloísa"
    className={`${MOVEMENT_ACTION_BUTTON_CLASS} gap-1.5 px-2.5 text-xs font-semibold`}
  >
    <FileText size={14} aria-hidden="true" />
    Epicrisis
  </button>
);
