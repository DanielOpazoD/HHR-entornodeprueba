/**
 * SettingsModal Component
 * 
 * Application configuration modal using the BaseModal pattern.
 * Includes table config, offline passport, demo data, and test agent sections.
 */

import React, { useRef, useState } from 'react';
import { Settings, Database, Bot, FileKey, Download, TableProperties, Upload, RotateCcw, Sparkles, MousePointer2, Move, Type } from 'lucide-react';
import { BaseModal, ModalSection } from '../shared/BaseModal';
import { useTableConfig } from '../../context/TableConfigContext';
import { useUISettings } from '../../context/UISettingsContext';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerateDemo: () => void;
  onRunTest: () => void;
  canDownloadPassport?: boolean;
  onDownloadPassport?: (role: string) => Promise<boolean>;
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
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Configuración"
      icon={<Settings size={18} />}
      size="md"
    >
      {/* Premium Aesthetics Section */}
      <ModalSection
        title="Estética Premium"
        icon={<Sparkles size={16} />}
        description="Personalice la apariencia y sensaciones táctiles del sistema."
        variant="info"
      >
        <div className="space-y-4">
          {/* Glassmorphism Toggle */}
          <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Sparkles size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Glassmorphism</p>
                <p className="text-[10px] text-slate-500">Efecto de cristal y profundidad</p>
              </div>
            </div>
            <button
              onClick={() => updateSetting('glassmorphism', !settings.glassmorphism)}
              className={`w-12 h-6 rounded-full transition-all relative ${settings.glassmorphism ? 'bg-medical-600' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.glassmorphism ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          {/* Animations Toggle */}
          <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                <Move size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Micro-interacciones</p>
                <p className="text-[10px] text-slate-500">Transiciones y animaciones suaves</p>
              </div>
            </div>
            <button
              onClick={() => updateSetting('animations', !settings.animations)}
              className={`w-12 h-6 rounded-full transition-all relative ${settings.animations ? 'bg-medical-600' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.animations ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          {/* Hover Effects Toggle */}
          <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-pink-50 text-pink-600 rounded-lg">
                <MousePointer2 size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Efectos Hover</p>
                <p className="text-[10px] text-slate-500">Iluminación al pasar el mouse</p>
              </div>
            </div>
            <button
              onClick={() => updateSetting('hoverEffects', !settings.hoverEffects)}
              className={`w-12 h-6 rounded-full transition-all relative ${settings.hoverEffects ? 'bg-medical-600' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.hoverEffects ? 'left-7' : 'left-1'}`} />
            </button>
          </div>

          {/* Typography Toggle */}
          <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                <Type size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Tipografía Moderna</p>
                <p className="text-[10px] text-slate-500">Usar fuente &apos;Plus Jakarta Sans&apos;</p>
              </div>
            </div>
            <button
              onClick={() => updateSetting('modernTypography', !settings.modernTypography)}
              className={`w-12 h-6 rounded-full transition-all relative ${settings.modernTypography ? 'bg-medical-600' : 'bg-slate-300'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.modernTypography ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
        </div>
      </ModalSection>

      {/* Table Configuration Section */}
      <ModalSection
        title="Configuración de Tabla"
        icon={<TableProperties size={16} />}
        description="Personalice el ancho de las columnas y márgenes de la tabla de Censo Diario."
      >
        {/* Page Margin Control */}
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
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>Sin margen</span>
            <span>Máximo</span>
          </div>
        </div>

        <div className="space-y-2">
          <button
            onClick={() => { setEditMode(!isEditMode); onClose(); }}
            className={`w-full py-2 rounded-xl font-bold text-sm transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 ${isEditMode
              ? 'bg-blue-500 text-white shadow-blue-500/20'
              : 'bg-slate-200 text-slate-700 shadow-slate-300/20 hover:bg-slate-300'
              }`}
          >
            <TableProperties size={16} />
            {isEditMode ? 'Desactivar Modo Edición' : 'Activar Modo Edición'}
          </button>

          <div className="flex gap-2">
            <button
              onClick={exportConfig}
              className="flex-1 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-slate-600/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <Download size={14} />
              Exportar
            </button>
            <button
              onClick={handleImportClick}
              className="flex-1 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-slate-600/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <Upload size={14} />
              Importar
            </button>
          </div>

          <button
            onClick={handleReset}
            className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-orange-500/20 active:scale-95 flex items-center justify-center gap-2"
          >
            <RotateCcw size={14} />
            Resetear a Valores por Defecto
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
      </ModalSection>

      {/* Passport Download Section - Only for admin users */}
      {canDownloadPassport && !isOfflineMode && onDownloadPassport && (
        <ModalSection
          title="Generar Pasaporte Offline"
          icon={<FileKey size={16} />}
          description={<>Genere un archivo pasaporte para acceder al sistema <strong>sin conexión a internet</strong>.<br /><span className="font-bold text-emerald-700">Válido por 3 años. Solo usted como admin puede generar estos pasaportes.</span></>}
          variant="success"
        >
          <div className="space-y-3">
            {/* Role Selector */}
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedPassportRole('admin')}
                className={`flex-1 py-2 px-3 rounded-xl font-bold text-sm transition-all border-2 flex items-center justify-center gap-2 ${selectedPassportRole === 'admin'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-600/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                  }`}
              >
                <FileKey size={14} />
                Admin
              </button>
              <button
                onClick={() => setSelectedPassportRole('nurse_hospital')}
                className={`flex-1 py-2 px-3 rounded-xl font-bold text-sm transition-all border-2 flex items-center justify-center gap-2 ${selectedPassportRole === 'nurse_hospital'
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-600/20'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'
                  }`}
              >
                <FileKey size={14} />
                Enfermería
              </button>
            </div>

            <button
              onClick={handlePassportDownload}
              disabled={isGenerating}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-emerald-600/20 active:scale-95 flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>Generando...</>
              ) : (
                <>
                  <Download size={16} />
                  Descargar Pasaporte {selectedPassportRole === 'admin' ? 'Admin' : 'Enfermería'}
                </>
              )}
            </button>
          </div>
        </ModalSection>
      )}

      {/* Demo Data Section */}
      <ModalSection
        title="Datos de Prueba (Demo)"
        icon={<Database size={16} />}
        description={<>Rellena la tabla actual con pacientes ficticios. Útil para practicar o ver cómo funciona el sistema.<br /><span className="font-bold text-blue-700">Nota: Sobrescribirá los datos del día actual.</span></>}
        variant="info"
      >
        <button
          onClick={() => { onGenerateDemo(); onClose(); }}
          className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-600/20 active:scale-95"
        >
          Generar Pacientes Demo
        </button>
      </ModalSection>

      {/* Test Agent Section */}
      <ModalSection
        title="Agente de Prueba (Auto-Test)"
        icon={<Bot size={16} />}
        description="Ejecuta un script automático que verifica la integridad del sistema, almacenamiento y cálculos matemáticos."
      >
        <button
          onClick={() => { onRunTest(); onClose(); }}
          className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-purple-600/20 active:scale-95"
        >
          Ejecutar Diagnóstico
        </button>
      </ModalSection>
    </BaseModal>
  );
};
