import React, { Suspense, lazy, useRef, useState } from 'react';
import {
  Bot,
  FileText,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  TableProperties,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig } from '@/context/TableConfigContext';
import { useUISettings } from '@/context/UISettingsContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { AccessRestricted } from './internal/AccessRestricted';
import RoleManagementView from './RoleManagementView';
import { ClinicalAIProviderRoutingPanel } from './ClinicalAIProviderRoutingPanel';
import {
  SettingsVisualTab,
  SettingsSecurityTab,
  SettingsTableTab,
} from '@/components/modals/SettingsModalTabs';

const LazyClinicalDocumentTemplatesManager = lazy(() =>
  import('./ClinicalDocumentTemplatesManager').then(module => ({
    default: module.ClinicalDocumentTemplatesManager,
  }))
);

type ConfigurationTab =
  | 'VISUAL'
  | 'TABLE'
  | 'SECURITY'
  | 'ROLES'
  | 'CLINICAL_TEMPLATES'
  | 'AI_PROVIDERS';

// Configuration view — admin-only page grouping BOTH user preferences (formerly
// "Preferencias" modal: visual, table, security) AND system administration
// (roles, clinical templates) as tabs on a single page.
export const ConfigurationView: React.FC = () => {
  const { role } = useAuth();
  const { confirm } = useConfirmDialog();
  const { notify } = useNotification();
  const [activeTab, setActiveTab] = useState<ConfigurationTab>('VISUAL');
  const {
    config,
    exportConfig,
    importConfig,
    resetToDefaults,
    isEditMode,
    setEditMode,
    updatePageMargin,
  } = useTableConfig();
  const { settings, updateSetting } = useUISettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (role !== 'admin') {
    return <AccessRestricted />;
  }

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        await importConfig(file);
        notify({
          type: 'success',
          title: 'Configuración importada',
          message: 'La configuración se aplicó correctamente.',
        });
      } catch {
        notify({
          type: 'error',
          title: 'Importación inválida',
          message: 'El archivo no se pudo procesar.',
        });
      }
      event.target.value = '';
    }
  };

  const handleReset = async () => {
    const confirmed = await confirm({
      title: 'Resetear configuración de columnas',
      message: '¿Está seguro de resetear la configuración de columnas a valores por defecto?',
      confirmText: 'Resetear',
      cancelText: 'Cancelar',
      variant: 'warning',
    });
    if (confirmed) {
      resetToDefaults();
    }
  };

  const tabs: Array<{
    id: ConfigurationTab;
    label: string;
    icon: typeof Settings2;
    color: string;
  }> = [
    { id: 'VISUAL', label: 'Visual', icon: Sparkles, color: 'text-fuchsia-400' },
    { id: 'TABLE', label: 'Tabla', icon: TableProperties, color: 'text-sky-400' },
    { id: 'SECURITY', label: 'Seguridad', icon: Shield, color: 'text-amber-400' },
    { id: 'ROLES', label: 'Roles y permisos', icon: ShieldCheck, color: 'text-indigo-400' },
    {
      id: 'AI_PROVIDERS',
      label: 'IA',
      icon: Bot,
      color: 'text-cyan-400',
    },
    {
      id: 'CLINICAL_TEMPLATES',
      label: 'Plantillas clínicas',
      icon: FileText,
      color: 'text-emerald-400',
    },
  ];

  return (
    <div className="animate-fade-in font-sans pb-16">
      <div className="bg-white border-b border-slate-200 px-6 py-3 shadow-sm sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 pr-4 border-r border-slate-200">
            <Settings2 size={16} className="text-slate-500" />
            <h1 className="text-sm font-bold text-slate-800">Configuración</h1>
          </div>

          <div className="flex gap-1 flex-wrap">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5',
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <Icon size={13} className={isActive ? '' : tab.color} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-[1200px] mx-auto px-4 py-6">
        {activeTab === 'VISUAL' && (
          <SettingsVisualTab settings={settings} updateSetting={updateSetting} />
        )}
        {activeTab === 'TABLE' && (
          <SettingsTableTab
            pageMargin={config.pageMargin}
            exportConfig={exportConfig}
            fileInputRef={fileInputRef}
            handleFileChange={handleFileChange}
            handleImportClick={handleImportClick}
            handleReset={handleReset}
            isEditMode={isEditMode}
            onClose={() => {}}
            setEditMode={setEditMode}
            updatePageMargin={updatePageMargin}
          />
        )}
        {activeTab === 'SECURITY' && <SettingsSecurityTab />}
        {activeTab === 'ROLES' && <RoleManagementView />}
        {activeTab === 'AI_PROVIDERS' && <ClinicalAIProviderRoutingPanel />}
        {activeTab === 'CLINICAL_TEMPLATES' && (
          <Suspense
            fallback={
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                Cargando plantillas clínicas...
              </div>
            }
          >
            <LazyClinicalDocumentTemplatesManager />
          </Suspense>
        )}
      </div>
    </div>
  );
};
