import { useState, useMemo, useCallback } from 'react';
import { useNotification, useConfirmDialog } from '@/context/UIContext';
import { useBackupFilesQuery, BackupFolder } from '@/hooks/useBackupFilesQuery';
import { deletePdf } from '@/services/backup/pdfStorageService';
import { deleteCensusFile } from '@/services/backup/censusStorageService';
import { deleteCudyrFile } from '@/features/cudyr/services/cudyrStorageService';
import { BaseStoredFile } from '@/services/backup/baseStorageService';
import { StoredPdfFile } from '@/services/backup/pdfStorageService';
import { useAuth } from '@/context/AuthContext';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntime';

export type BackupType = 'handoff' | 'census' | 'cudyr';

export const useBackupFileBrowser = (initialBackupType: BackupType = 'handoff') => {
  const [selectedBackupType, setSelectedBackupType] = useState<BackupType>(initialBackupType);
  const [path, setPath] = useState<string[]>(() => {
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    return [currentYear, monthNames[now.getMonth()]];
  });
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<BaseStoredFile | StoredPdfFile | null>(null);

  const { success, error: notifyError } = useNotification();
  const { confirm } = useConfirmDialog();
  const { role } = useAuth();
  const canDelete = role === 'admin';

  const {
    data: items = [],
    isLoading,
    isRefetching,
    refetch,
  } = useBackupFilesQuery(selectedBackupType, path);

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => {
      if (item.type === 'folder') return (item.data as BackupFolder).name.toLowerCase().includes(q);
      const file = item.data as BaseStoredFile;
      return file.name.toLowerCase().includes(q) || (file.date && file.date.includes(q));
    });
  }, [items, searchQuery]);

  const handleFolderClick = useCallback(
    (folderData: BackupFolder) => {
      if (folderData.type === 'year') {
        setPath([folderData.name]);
      } else if (folderData.type === 'month') {
        setPath([path[0], folderData.name]);
      }
    },
    [path]
  );

  const handleBreadcrumbNavigate = useCallback(
    (index: number) => {
      if (index === -1) {
        setPath([]);
      } else {
        setPath(path.slice(0, index + 1));
      }
    },
    [path]
  );

  const handleDelete = async (file: BaseStoredFile | StoredPdfFile) => {
    const confirmed = await confirm({
      title: 'Eliminar Archivo',
      message: `¿Está seguro de eliminar "${file.name}"?\nEsta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      variant: 'danger',
    });

    if (!confirmed) return;

    try {
      if (selectedBackupType === 'handoff') {
        const pdfFile = file as StoredPdfFile;
        await deletePdf(pdfFile.date, pdfFile.shiftType);
      } else if (selectedBackupType === 'census') {
        await deleteCensusFile(file.date);
      } else {
        await deleteCudyrFile(file.date);
      }
      success('Archivo eliminado');
      refetch();
    } catch (err) {
      console.error('Delete error:', err);
      notifyError('Error al eliminar archivo');
    }
  };

  const handleDownload = useCallback((file: BaseStoredFile | StoredPdfFile) => {
    if (file.downloadUrl) {
      defaultBrowserWindowRuntime.open(file.downloadUrl, '_blank');
    }
  }, []);

  const changeBackupType = useCallback((type: BackupType) => {
    setSelectedBackupType(type);
    const now = new Date();
    const currentYear = now.getFullYear().toString();
    const monthNames = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    setPath([currentYear, monthNames[now.getMonth()]]);
  }, []);

  return {
    selectedBackupType,
    path,
    viewMode,
    setViewMode,
    searchQuery,
    setSearchQuery,
    previewFile,
    setPreviewFile,
    items,
    filteredItems,
    isLoading,
    isRefetching,
    canDelete,
    refetch,
    handlers: {
      handleFolderClick,
      handleBreadcrumbNavigate,
      handleDelete,
      handleDownload,
      changeBackupType,
    },
  };
};
