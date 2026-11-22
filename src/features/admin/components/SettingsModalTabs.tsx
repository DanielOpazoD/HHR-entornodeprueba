import React from 'react';
import {
  Download,
  PanelsTopLeft,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  TableProperties,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/base/Button';
import { ModalSection } from '@/components/shared/baseModalSection';
import { SecuritySettings } from './SecuritySettings';

interface TableTabProps {
  pageMargin: number;
  exportConfig: () => void;
  handleImportClick: () => void;
  handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleReset: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isEditMode: boolean;
  onClose: () => void;
  setEditMode: (enabled: boolean) => void;
  updatePageMargin: (value: number) => void;
}

export const SettingsTableTab: React.FC<TableTabProps> = ({
  pageMargin,
  exportConfig,
  fileInputRef,
  handleFileChange,
  handleImportClick,
  handleReset,
  isEditMode,
  onClose,
  setEditMode,
  updatePageMargin,
}) => (
  <ModalSection
    title="Configuración de Tabla"
    icon={<TableProperties size={16} />}
    description="Separamos edición, respaldo y recuperación en bloques relacionados para que todo quede visible."
    className="min-h-[360px]"
  >
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-800">Espaciado general</p>
            <p className="text-xs text-slate-500">Ajusta el respiro lateral del censo.</p>
          </div>
          <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
            {pageMargin}px
          </div>
        </div>
        <input
          type="range"
          min="0"
          max="64"
          step="4"
          value={pageMargin}
          onChange={event => updatePageMargin(parseInt(event.target.value, 10))}
          className="w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-blue-500"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <button
          onClick={() => {
            setEditMode(!isEditMode);
            onClose();
          }}
          className={`rounded-2xl border p-4 text-left transition-all ${
            isEditMode
              ? 'border-medical-300 bg-medical-50 shadow-sm'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="mb-2 flex items-center gap-2 text-slate-800">
            <PanelsTopLeft size={16} />
            <span className="text-sm font-bold">
              {isEditMode ? 'Modo edición activo' : 'Activar modo edición'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Reorganiza anchos de columnas directamente sobre la tabla.
          </p>
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-800">
            <SlidersHorizontal size={16} />
            <span className="text-sm font-bold">Respaldo de layout</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={exportConfig}
              className="flex-1"
              icon={<Download size={14} />}
            >
              Exportar
            </Button>
            <Button
              variant="outline"
              onClick={handleImportClick}
              className="flex-1"
              icon={<Upload size={14} />}
            >
              Importar
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
        <div className="mb-3">
          <p className="text-sm font-bold text-rose-800">Recuperación rápida</p>
          <p className="text-xs text-rose-600">
            Vuelva al estado base si la tabla quedó demasiado personalizada.
          </p>
        </div>
        <Button
          variant="danger"
          onClick={handleReset}
          className="w-full"
          icon={<RotateCcw size={14} />}
        >
          Resetear a Valores por Defecto
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  </ModalSection>
);

export const SettingsSecurityTab: React.FC = () => (
  <div className="space-y-4">
    <ModalSection
      title="Seguridad y Bloqueo"
      icon={<Shield size={16} />}
      description="Configure PIN, acceso rápido y tiempos de bloqueo automático."
      variant="warning"
    >
      <SecuritySettings />
    </ModalSection>
  </div>
);
