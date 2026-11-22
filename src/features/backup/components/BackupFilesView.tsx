/**
 * BackupFilesView
 *
 * View for browsing and downloading backup files (Handoffs, Census, CUDYR).
 * Includes internal tabs for switching between backup types.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useBackupFileBrowser } from '@/features/backup/hooks/useBackupFileBrowser';
import type { BackupType } from '@/hooks/backupFileBrowserContracts';
import { BackupFilesToolbar } from './internal/BackupFilesToolbar';
import { BackupFilesContent } from './internal/BackupFilesContent';
import { BackupFilesPreview } from './internal/BackupFilesPreview';

interface BackupFilesViewProps {
  backupType?: BackupType;
}

export const BackupFilesView: React.FC<BackupFilesViewProps> = ({
  backupType: initialBackupType = 'handoff',
}) => {
  const {
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
    handlers,
  } = useBackupFileBrowser(initialBackupType);

  const magicLabel =
    selectedBackupType === 'handoff'
      ? 'Respaldar faltantes (día+noche)'
      : selectedBackupType === 'census'
        ? 'Respaldar censos faltantes'
        : 'Respaldar cierres CUDYR faltantes';

  return (
    <div className="space-y-6 animate-in fade-in duration-500" data-testid="backup-files-view">
      <BackupFilesToolbar
        selectedBackupType={selectedBackupType}
        path={path}
        viewMode={viewMode}
        setViewMode={setViewMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        isLoading={isLoading}
        isRefetching={isRefetching}
        canRunMagicBackfill={canRunMagicBackfill}
        isMagicBackfilling={isMagicBackfilling}
        magicLabel={magicLabel}
        onChangeBackupType={handlers.changeBackupType}
        onBreadcrumbNavigate={handlers.handleBreadcrumbNavigate}
        onMagicBackfill={handlers.handleMagicMonthBackfill}
        onRefresh={refetch}
      />

      {isMagicBackfilling && (
        <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-xl px-3 py-2 w-fit">
          <Loader2 size={14} className="animate-spin" />
          <span>
            Respaldo masivo en curso
            {magicBackfillProgress
              ? ` (${magicBackfillProgress.completed}/${magicBackfillProgress.total})`
              : ''}
            {magicBackfillProgress?.currentLabel ? ` · ${magicBackfillProgress.currentLabel}` : ''}
          </span>
        </div>
      )}
      <div className="min-h-[400px]">
        <BackupFilesContent
          items={items}
          filteredItems={filteredItems}
          path={path}
          selectedBackupType={selectedBackupType}
          viewMode={viewMode}
          isLoading={isLoading}
          isRefetching={isRefetching}
          canDelete={canDelete}
          onPreviewFile={setPreviewFile}
          onOpenFolder={handlers.handleFolderClick}
          onDownloadFile={handlers.handleDownload}
          onDeleteFile={handlers.handleDelete}
        />
      </div>

      <BackupFilesPreview
        previewFile={previewFile}
        selectedBackupType={selectedBackupType}
        onClose={() => setPreviewFile(null)}
        onDownload={handlers.handleDownload}
      />
    </div>
  );
};

export default BackupFilesView;
