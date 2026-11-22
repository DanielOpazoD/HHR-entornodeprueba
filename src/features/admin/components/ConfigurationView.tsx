import React, { useRef } from 'react';
import {
  Bot,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  TableProperties,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTableConfig } from '@/context/TableConfigContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { AccessRestricted } from './internal/AccessRestricted';
import { AdminTabsShell } from './internal/AdminTabsShell';
import RoleManagementView from './RoleManagementView';
import { ClinicalAIProviderRoutingPanel } from './ClinicalAIProviderRoutingPanel';
import {
  SettingsSecurityTab,
  SettingsTableTab,
} from '@/features/admin/components/SettingsModalTabs';
import { TreatingPhysiciansSettings } from './TreatingPhysiciansSettings';
import { VitalSignsVisualRangesSettings } from './VitalSignsVisualRangesSettings';
import { CensusNursingScalesSetting } from './CensusNursingScalesSetting';
import { canAccessAppModuleRoute } from '@/shared/access/operationalAccessPolicy';

// Configuration view — admin-only page grouping BOTH user preferences (formerly
// "Preferencias" modal: visual, table, security) AND system administration
// (roles) as tabs on a single page.
export const ConfigurationView: React.FC = () => {
  const { role } = useAuth();
  const { confirm } = useConfirmDialog();
  const { notify } = useNotification();
  const {
    config,
    exportConfig,
    importConfig,
    resetToDefaults,
    isEditMode,
    setEditMode,
    updatePageMargin,
  } = useTableConfig();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!canAccessAppModuleRoute({ role, module: 'CONFIGURATION' })) {
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

  return (
    <AdminTabsShell
      title="Configuración"
      icon={Settings2}
      contentClassName="max-w-[1200px] mx-auto px-4 py-6"
      tabs={[
        {
          id: 'VISUAL',
          label: 'Visual',
          icon: Sparkles,
          color: 'text-fuchsia-400',
          content: (
            <div className="space-y-4">
              <CensusNursingScalesSetting />
              <VitalSignsVisualRangesSettings />
            </div>
          ),
        },
        {
          id: 'TABLE',
          label: 'Tabla',
          icon: TableProperties,
          color: 'text-sky-400',
          content: (
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
          ),
        },
        {
          id: 'SECURITY',
          label: 'Seguridad',
          icon: Shield,
          color: 'text-amber-400',
          content: <SettingsSecurityTab />,
        },
        {
          id: 'ROLES',
          label: 'Roles y permisos',
          icon: ShieldCheck,
          color: 'text-indigo-400',
          content: <RoleManagementView />,
        },
        {
          id: 'PHYSICIANS',
          label: 'Médicos',
          icon: Stethoscope,
          color: 'text-sky-400',
          content: <TreatingPhysiciansSettings />,
        },
        {
          id: 'AI_PROVIDERS',
          label: 'IA',
          icon: Bot,
          color: 'text-cyan-400',
          content: <ClinicalAIProviderRoutingPanel />,
        },
      ]}
    />
  );
};
