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
    mode: 'print' | 'editable'
  ) => Promise<void>;
  previewPageUrls?: readonly string[];
  onDirtyChange?: (dirty: boolean) => void;
}

export const MEDIF_SECONDARY_BUTTON =
  'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-medical-300 hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600 disabled:cursor-not-allowed disabled:opacity-50';

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
