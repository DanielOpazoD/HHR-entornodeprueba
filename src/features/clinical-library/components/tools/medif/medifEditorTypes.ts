import { buttonClassName } from '@/components/ui/base/buttonStyles';
import type { MedifValues } from '../../../domain/medifDraft';
import type { MedifPreferences } from '../../../domain/medifPreferences';

export interface MedifEditorPatient {
  key: string;
  label: string;
  values: MedifValues;
  sourceLabel: string;
}

export interface MedifEditorProps {
  patients: ReadonlyArray<MedifEditorPatient>;
  onBack: () => void;
  onClose: () => void;
  onGeneratePdf: (
    values: MedifValues,
    preferences: MedifPreferences,
    mode: 'print' | 'editable',
    signal?: AbortSignal
  ) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

export const MEDIF_SECONDARY_BUTTON = buttonClassName('outline', 'sm');

export const downloadMedifJson = (content: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
