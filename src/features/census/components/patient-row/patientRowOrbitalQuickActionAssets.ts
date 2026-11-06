import hoonuIcon from '../../../../../Hoonu.png';
import rongorongoIcon from '../../../../../Rongorongo.png';
import mangaiIcon from '../../../../../Mangai.png';
import ahutepitokuraIcon from '../../../../../Ahutepitokura.png';
import type { PatientRowOrbitalQuickActionAsset } from '@/features/census/controllers/patientRowOrbitalQuickActionsController';

export const PATIENT_ROW_ORBITAL_TRIGGER_ICON_SRC = hoonuIcon;

export const PATIENT_ROW_ORBITAL_ICON_SRC: Record<PatientRowOrbitalQuickActionAsset, string> = {
  rongorongo: rongorongoIcon,
  mangai: mangaiIcon,
  ahutepitokura: ahutepitokuraIcon,
};
