import React from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import type {
  PrescriptionMonthlyPdfColorMode,
  PrescriptionMonthlyPdfImageQuality,
  PrescriptionsPerPageOption,
} from '@/features/prescriptions/services/prescriptionMonthlyPdfService';

interface PrescriptionMonthlyPdfOptionsPanelProps {
  colorMode: PrescriptionMonthlyPdfColorMode;
  imageQuality: PrescriptionMonthlyPdfImageQuality;
  isExporting: boolean;
  onCancel: () => void;
  onColorModeChange: (value: PrescriptionMonthlyPdfColorMode) => void;
  onExport: () => void;
  onImageQualityChange: (value: PrescriptionMonthlyPdfImageQuality) => void;
  onPrescriptionsPerPageChange: (value: PrescriptionsPerPageOption) => void;
  prescriptionsPerPage: PrescriptionsPerPageOption;
}

export const PrescriptionMonthlyPdfOptionsPanel: React.FC<
  PrescriptionMonthlyPdfOptionsPanelProps
> = ({
  colorMode,
  imageQuality,
  isExporting,
  onCancel,
  onColorModeChange,
  onExport,
  onImageQualityChange,
  onPrescriptionsPerPageChange,
  prescriptionsPerPage,
}) => (
  <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
        <span>Recetas por página</span>
        <select
          value={prescriptionsPerPage}
          onChange={event =>
            onPrescriptionsPerPageChange(Number(event.target.value) as PrescriptionsPerPageOption)
          }
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={4}>4</option>
          <option value={6}>6</option>
        </select>
      </label>
      <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
        <span>Color del PDF</span>
        <select
          value={colorMode}
          onChange={event =>
            onColorModeChange(event.target.value as PrescriptionMonthlyPdfColorMode)
          }
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value="color">Color</option>
          <option value="grayscale">B/N</option>
        </select>
      </label>
      <label className="grid gap-1 text-[11px] font-semibold text-slate-600">
        <span>Calidad de imagen</span>
        <select
          value={imageQuality}
          onChange={event =>
            onImageQualityChange(event.target.value as PrescriptionMonthlyPdfImageQuality)
          }
          className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        >
          <option value="medium">Media</option>
          <option value="reduced">Reducida</option>
          <option value="compact">Compacta</option>
          <option value="low">Baja</option>
        </select>
        {imageQuality === 'low' && (
          <span className="max-w-48 text-[10px] font-medium leading-tight text-amber-700">
            Máximo ahorro: revisar legibilidad antes de archivar.
          </span>
        )}
      </label>
      <button
        type="button"
        onClick={onExport}
        disabled={isExporting}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white shadow-sm hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isExporting ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
        Generar PDF
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isExporting}
        className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Cancelar
      </button>
    </div>
  </section>
);
