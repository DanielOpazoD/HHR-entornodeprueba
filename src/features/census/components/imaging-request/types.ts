import type { PatientData } from '@/types/domain/patient';
import { LucideIcon } from 'lucide-react';

export type DocumentOption = 'solicitud' | 'encuesta' | 'consentimiento';

export interface ImagingRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  patient: PatientData;
}

export interface DocumentTypeOption {
  id: DocumentOption;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  disabled: boolean;
}

export interface ActiveTextMark {
  x: number;
  y: number;
  text: string;
}
