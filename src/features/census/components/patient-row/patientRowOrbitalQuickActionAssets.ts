import hoonuIcon from '../../../../../Hoonu.png';
import manutaraIcon from '../../../../../Manutara2.png';
import mangaiIcon from '../../../../../Mangai.png';
import ahutepitokuraIcon from '../../../../../Ahutepitokura.png';
import rongorongoIcon from '../../../../../Rongorongo.png';
import rapaIcon from '../../../../../Rapa.png';
import type { PatientRowOrbitalQuickActionAsset } from '@/features/census/controllers/patientRowOrbitalQuickActionsController';

export const PATIENT_ROW_ORBITAL_TRIGGER_ICON_SRC = hoonuIcon;

export const PATIENT_ROW_ORBITAL_ICON_SRC: Record<PatientRowOrbitalQuickActionAsset, string> = {
  manutara: manutaraIcon,
  mangai: mangaiIcon,
  ahutepitokura: ahutepitokuraIcon,
  rongorongo: rongorongoIcon,
  rapa: rapaIcon,
};
