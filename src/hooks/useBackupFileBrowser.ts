import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotification, useConfirmDialog } from '@/context/UIContext';
import { useBackupFilesQuery } from '@/hooks/useBackupFilesQuery';
import { useAuth } from '@/context/AuthContext';
import { useBackupFileBrowserActions } from '@/hooks/useBackupFileBrowserActions';
import { canUseAdminMaintenanceActions } from '@/shared/access/operationalAccessPolicy';
import {
  buildInitialBackupBrowserPath,
  filterBackupBrowserItems,
  resolveCanRunMagicBackfill,
} from '@/hooks/backupFileBrowserController';
import { presentBackupListingOutcome } from '@/hooks/controllers/backupStorageOutcomeController';
import type { BackupFolder, BackupType } from '@/hooks/backupFileBrowserContracts';
import type { BaseStoredFile, StoredPdfFile } from '@/types/backupArtifacts';

export const useBackupFileBrowser = (initialBackupType: BackupType = 'handoff') => {
  const { success, warning, info, error: notifyError } = useNotification();
  const { confirm } = useConfirmDialog();
  const { role } = useAuth();
  const canDelete = canUseAdminMaintenanceActions(role);
  const lastReportSignatureRef = useRef('');
  const [selectedBackupType, setSelectedBackupType] = useState<BackupType>(initialBackupType);
  const [path, setPath] = useState<string[]>(() => buildInitialBackupBrowserPath());
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewFile, setPreviewFile] = useState<BaseStoredFile | StoredPdfFile | null>(null);

  const handleFolderClick = useCallback((folderData: BackupFolder) => {
    if (folderData.type === 'year') {
      setPath([folderData.name]);
      return;
    }

    if (folderData.type === 'month') {
      setPath(currentPath =>
        currentPath[0] ? [currentPath[0], folderData.name] : [folderData.name]
      );
    }
  }, []);

  const handleBreadcrumbNavigate = useCallback((index: number) => {
    setPath(currentPath => (index === -1 ? [] : currentPath.slice(0, index + 1)));
  }, []);

  const changeBackupType = useCallback((type: BackupType) => {
    setSelectedBackupType(type);
  }, []);

  const {
    data: items = [],
    listingOutcome,
    isLoading,
    isRefetching,
    refetch,
  } = useBackupFilesQuery(selectedBackupType, path);
  const filteredItems = useMemo(
    () => filterBackupBrowserItems(items, searchQuery),
    [items, searchQuery]
  );
  const canRunMagicBackfill = resolveCanRunMagicBackfill(role, path, isLoading);

  const {
    isMagicBackfilling,
    magicBackfillProgress,
    handleDelete,
    handleDownload,
    handleMagicMonthBackfill,
  } = useBackupFileBrowserActions({
    selectedBackupType,
    path,
    role,
    items,
    refetch,
    notifications: {
      success,
      warning,
      info,
      error: notifyError,
    },
    confirm,
  });

  useEffect(() => {
    const signature = JSON.stringify(listingOutcome);
    if (lastReportSignatureRef.current === signature) {
      return;
    }
    lastReportSignatureRef.current = signature;

    if (!listingOutcome) {
      return;
    }

    const notice = presentBackupListingOutcome(listingOutcome);
    if (notice?.channel === 'warning') {
      warning(notice.title || 'Respaldos', notice.message);
      return;
    }
    if (notice?.channel === 'info') {
      info(notice.title || 'Respaldos', notice.message);
      return;
    }
    if (notice?.channel === 'error') {
      notifyError(notice.title || 'Respaldos', notice.message);
    }
  }, [info, listingOutcome, notifyError, warning]);

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
    canRunMagicBackfill,
    isMagicBackfilling,
    magicBackfillProgress,
    refetch,
    handlers: {
      handleFolderClick,
      handleBreadcrumbNavigate,
      handleDelete,
      handleDownload,
      changeBackupType,
      handleMagicMonthBackfill,
    },
  };
};
