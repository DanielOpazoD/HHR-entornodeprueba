import React from 'react';
import { Database, FolderArchive, Users } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AccessRestricted } from './internal/AccessRestricted';
import { AdminTabsShell } from './internal/AdminTabsShell';
import { DataMaintenanceView } from './DataMaintenanceView';
import { PatientMasterView } from './PatientMasterView';
import { BackupFilesView } from '@/features/backup/public';
import { canAccessAppModuleRoute } from '@/shared/access/operationalAccessPolicy';

// Data view — admin-only page grouping all hospital data administration:
//   - "Mantenimiento" (JSON import/export) ← was "Mantenimiento de Datos" menu item
//   - "Respaldos"    (Drive backups)       ← was "Archivos" utility dropdown
//   - "Pacientes"    (master index)        ← was "Base de Pacientes" menu item
// The DATA_MAINTENANCE, BACKUP_FILES and PATIENT_MASTER_INDEX module slots remain
// accessible via direct URL as fallback for deep links.
export const DataView: React.FC = () => {
  const { role } = useAuth();

  if (!canAccessAppModuleRoute({ role, module: 'DATA' })) {
    return <AccessRestricted />;
  }

  return (
    <AdminTabsShell
      title="Datos"
      icon={Database}
      tabs={[
        {
          id: 'MAINTENANCE',
          label: 'Mantenimiento',
          icon: Database,
          color: 'text-emerald-400',
          content: <DataMaintenanceView />,
        },
        {
          id: 'BACKUPS',
          label: 'Respaldos',
          icon: FolderArchive,
          color: 'text-amber-400',
          content: <BackupFilesView backupType="handoff" />,
        },
        {
          id: 'PATIENTS',
          label: 'Base de pacientes',
          icon: Users,
          color: 'text-sky-400',
          content: <PatientMasterView />,
        },
      ]}
    />
  );
};
