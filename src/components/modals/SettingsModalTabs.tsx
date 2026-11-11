import React from 'react';
import {
  Bot,
  Download,
  MousePointer2,
  Move,
  PanelsTopLeft,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
  Type,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/base/Button';
import { ModalSection } from '@/components/shared/baseModalSection';
import { SecuritySettings } from './SecuritySettings';

export type SettingsTabId = 'visual' | 'table' | 'security' | 'diagnostics';

export const settingsTabs: Array<{
  id: SettingsTabId;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'visual', label: 'Visual', icon: Sparkles },
  { id: 'table', label: 'Tabla', icon: TableProperties },
  { id: 'security', label: 'Seguridad', icon: Shield },
  { id: 'diagnostics', label: 'Diagnóstico', icon: Bot },
];

const aestheticOptions = [
  {
    id: 'glassmorphism',
    label: 'Glassmorphism',
    desc: 'Cristal, profundidad y capas flotantes',
    icon: Sparkles,
    iconClassName: 'bg-blue-50 text-blue-600',
  },
  {
    id: 'animations',
    label: 'Micro-interacciones',
    desc: 'Transiciones suaves al navegar y editar',
    icon: Move,
    iconClassName: 'bg-fuchsia-50 text-fuchsia-600',
  },
  {
    id: 'hoverEffects',
    label: 'Efectos hover',
    desc: 'Resaltes al pasar el mouse por controles',
    icon: MousePointer2,
    iconClassName: 'bg-rose-50 text-rose-600',
  },
  {
    id: 'modernTypography',
    label: 'Tipografía moderna',
    desc: 'Usar fuente "Plus Jakarta Sans"',
    icon: Type,
    iconClassName: 'bg-emerald-50 text-emerald-600',
  },
] as const;

interface VisualTabProps {
  settings: Record<(typeof aestheticOptions)[number]['id'], boolean>;
  updateSetting: (setting: (typeof aestheticOptions)[number]['id'], value: boolean) => void;
}

export const SettingsVisualTab: React.FC<VisualTabProps> = ({ settings, updateSetting }) => (
  <ModalSection
    title="Estética Premium"
    icon={<Sparkles size={16} />}
    description="Controles visuales agrupados en una sola vista compacta para evitar paneles interminables."
    variant="info"
    className="min-h-[360px]"
  >
    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 via-white to-slate-50 p-3">
      <div className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-white/70 bg-white/80 p-3 shadow-sm">
        <div>
          <p className="text-sm font-bold text-slate-800">Perfiles visuales</p>
          <p className="text-xs text-slate-500">
            Active solo lo que realmente quiera notar al usar el sistema.
          </p>
        </div>
        <div className="hidden rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-700 sm:block">
          4 ajustes
        </div>
      </div>

      <div className="grid gap-2.5">
        {aestheticOptions.map(item => (
          <div
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-slate-100 bg-white/90 p-3 shadow-sm"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className={`rounded-lg p-2 ${item.iconClassName}`}>
                <item.icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-700">{item.label}</p>
                <p className="text-[11px] text-slate-500">{item.desc}</p>
              </div>
            </div>
            <button
              onClick={() => updateSetting(item.id, !settings[item.id])}
              className={`relative h-6 w-12 rounded-full transition-all ${
                settings[item.id] ? 'bg-medical-600' : 'bg-slate-300'
              }`}
              aria-pressed={settings[item.id]}
              aria-label={`Alternar ${item.label}`}
            >
              <div
                className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
                  settings[item.id] ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  </ModalSection>
);

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

interface DiagnosticsTabProps {
  onClose: () => void;
  onRunTest: () => void;
}

export const SettingsDiagnosticsTab: React.FC<DiagnosticsTabProps> = ({ onClose, onRunTest }) => (
  <div className="grid gap-4">
    <ModalSection title="Diagnóstico" icon={<Bot size={16} />} className="min-h-[220px]">
      <p className="mb-4 text-xs text-slate-500">
        Lance una prueba rápida del sistema desde este mismo panel.
      </p>
      <Button
        onClick={() => {
          onRunTest();
          onClose();
        }}
        variant="outline"
        className="w-full"
      >
        Ejecutar Test
      </Button>
    </ModalSection>
  </div>
);
