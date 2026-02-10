import React, { useRef, useState } from 'react';
import { Settings, Database, Bot, FileKey, Download, TableProperties, Upload, RotateCcw, Sparkles, MousePointer2, Move, Type, Shield } from 'lucide-react';
import { Modal, ModalSection, Button } from '@/core/ui';
import { useTableConfig } from '@/context/TableConfigContext';
import { useUISettings } from '@/context/UISettingsContext';
import { SecuritySettings } from './SecuritySettings';

import { UserRole } from '@/types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateDemo: () => void;
  onRunTest: () => void;
  canDownloadPassport?: boolean;
  onDownloadPassport?: (role: UserRole) => Promise<boolean>;
  isOfflineMode?: boolean;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onGenerateDemo,
  onRunTest,
  canDownloadPassport = false,
  onDownloadPassport,
  isOfflineMode = false
}) => {
  const { config, exportConfig, importConfig, resetToDefaults, isEditMode, setEditMode, updatePageMargin } = useTableConfig();
  const { settings, updateSetting } = useUISettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Passport generation states
  const [selectedPassportRole, setSelectedPassportRole] = useState<'admin' | 'nurse_hospital'>('admin');
  const [isGenerating, setIsGenerating] = useState(false);

  const handlePassportDownload = async () => {
    if (onDownloadPassport) {
      setIsGenerating(true);
      try {
        const success = await onDownloadPassport(selectedPassportRole);
        if (success) {
          onClose();
        }
      } catch (err) {
        console.error('Error generando pasaporte:', err);
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await importConfig(file);
        alert('Configuración importada correctamente');
      } catch {
        alert('Error al importar: archivo inválido');
      }
      e.target.value = '';
    }
  };

  const handleReset = () => {
    if (confirm('¿Está seguro de resetear la configuración de columnas a valores por defecto?')) {
      resetToDefaults();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración"
      icon={<Settings size={18} />}
      size="md"
    >
      {/* Security Section */}
      <ModalSection
        title="Seguridad y Bloqueo"
        icon={<Shield size={16} />}
        description="Configure un PIN de acceso y tiempos de bloqueo automático."
        variant="warning"
      >
        <SecuritySettings />
      </ModalSection>

      {/* Aesthetics Section */}
      <ModalSection
        title="Estética Premium"
        icon={<Sparkles size={16} />}
        description="Personalice la apariencia y sensaciones táctiles del sistema."
        variant="info"
      >
        {(['glassmorphism', 'animations', 'hoverEffects', 'modernTypography'] as const).map((id) => {
          const item = {
            glassmorphism: { label: 'Glassmorphism', desc: 'Efecto de cristal y profundidad', icon: Sparkles, color: 'blue' },
            animations: { label: 'Micro-interacciones', desc: 'Transiciones y animaciones suaves', icon: Move, color: 'purple' },
            hoverEffects: { label: 'Efectos Hover', desc: 'Iluminación al pasar el mouse', icon: MousePointer2, color: 'pink' },
            modernTypography: { label: 'Tipografía Moderna', desc: 'Usar fuente "Plus Jakarta Sans"', icon: Type, color: 'emerald' },
          }[id];

          return (
            <div key={id} className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-slate-100">
              <div className="flex items-center gap-3">
                <div className={`p-2 bg-${item.color}-50 text-${item.color}-600 rounded-lg`}>
                  <item.icon size={18} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700">{item.label}</p>
                  <p className="text-[10px] text-slate-500">{item.desc}</p>
                </div>
              </div>
              <button
                onClick={() => updateSetting(id, !settings[id])}
                className={`w-12 h-6 rounded-full transition-all relative ${settings[id] ? 'bg-medical-600' : 'bg-slate-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings[id] ? 'left-7' : 'left-1'}`} />
              </button>
            </div>
          );
        })}
      </ModalSection>

      {/* Table Configuration Section */}
      <ModalSection
        title="Configuración de Tabla"
        icon={<TableProperties size={16} />}
        description="Personalice el ancho de las columnas y márgenes de la tabla de Censo Diario."
      >
        <div className="mb-4 p-3 bg-slate-100/50 rounded-xl">
          <label className="text-xs font-bold text-slate-700 mb-2 block">
            Margen de Página: {config.pageMargin}px
          </label>
          <input
            type="range"
            min="0"
            max="64"
            step="4"
            value={config.pageMargin}
            onChange={(e) => updatePageMargin(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
        </div>

        <div className="space-y-2">
          <Button
            variant={isEditMode ? 'primary' : 'secondary'}
            onClick={() => { setEditMode(!isEditMode); onClose(); }}
            className="w-full"
            icon={<TableProperties size={16} />}
          >
            {isEditMode ? 'Desactivar Modo Edición' : 'Activar Modo Edición'}
          </Button>

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
      </ModalSection>

      {/* Passport Download Section */}
      {canDownloadPassport && !isOfflineMode && onDownloadPassport && (
        <ModalSection
          title="Generar Pasaporte Offline"
          icon={<FileKey size={16} />}
          description={<>Genere un archivo pasaporte para acceder al sistema <strong>sin conexión a internet</strong>.<br /><span className="font-bold text-emerald-700 text-[10px]">Válido por 3 años. Solo administradores pueden generar estos archivos.</span></>}
          variant="success"
        >
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                variant={selectedPassportRole === 'admin' ? 'primary' : 'outline'}
                onClick={() => setSelectedPassportRole('admin')}
                className={`flex-1 ${selectedPassportRole === 'admin' ? 'bg-emerald-600 border-emerald-600' : ''}`}
                icon={<FileKey size={14} />}
              >
                Admin
              </Button>
              <Button
                variant={selectedPassportRole === 'nurse_hospital' ? 'primary' : 'outline'}
                onClick={() => setSelectedPassportRole('nurse_hospital')}
                className={`flex-1 ${selectedPassportRole === 'nurse_hospital' ? 'bg-emerald-600 border-emerald-600' : ''}`}
                icon={<FileKey size={14} />}
              >
                Enfermería
              </Button>
            </div>

            <Button
              onClick={handlePassportDownload}
              isLoading={isGenerating}
              variant="primary"
              className="w-full bg-emerald-600 hover:bg-emerald-700 border-emerald-600"
              icon={<Download size={16} />}
            >
              Descargar Pasaporte {selectedPassportRole === 'admin' ? 'Admin' : 'Enfermería'}
            </Button>
          </div>
        </ModalSection>
      )}

      {/* Demo and Diagnostics Section */}
      <div className="grid grid-cols-2 gap-4">
        <ModalSection
          title="Datos Demo"
          icon={<Database size={16} />}
          variant="info"
        >
          <Button
            onClick={() => { onGenerateDemo(); onClose(); }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            Generar Demo
          </Button>
        </ModalSection>

        <ModalSection
          title="Diagnóstico"
          icon={<Bot size={16} />}
        >
          <Button
            onClick={() => { onRunTest(); onClose(); }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            Ejecutar Test
          </Button>
        </ModalSection>
      </div>
    </Modal>
  );
};
