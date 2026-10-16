import { Check } from 'lucide-react';
import { MEDIF_SECONDARY_BUTTON } from './medifEditorTypes';

export const MedifHabitualButton = ({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) => (
  <button
    type="button"
    className={`${MEDIF_SECONDARY_BUTTON} medif-habitual-button`}
    onClick={onClick}
    disabled={disabled}
    title="Completar campos vacíos con las respuestas habituales; conservar las respuestas existentes"
  >
    <Check size={16} aria-hidden="true" /> Respuestas habituales
  </button>
);
