import React from 'react';

import { PdfViewerModal } from '@/features/backup/components/PdfViewerModal';
import type { BackupType } from '@/hooks/backupFileBrowserContracts';
import type { BaseStoredFile, StoredPdfFile } from '@/types/backupArtifacts';

const ExcelViewerModal = React.lazy(() =>
  import('@/features/backup/components/ExcelViewerModal').then(module => ({
    default: module.ExcelViewerModal,
  }))
);

interface BackupFilesPreviewProps {
  previewFile: BaseStoredFile | StoredPdfFile | null;
  selectedBackupType: BackupType;
  onClose: () => void;
  onDownload: (file: BaseStoredFile | StoredPdfFile) => void;
}

export const BackupFilesPreview: React.FC<BackupFilesPreviewProps> = ({
  previewFile,
  selectedBackupType,
  onClose,
  onDownload,
}) => {
  if (!previewFile) {
    return null;
  }

  if (previewFile.name.endsWith('.xlsx')) {
    return (
      <React.Suspense fallback={null}>
        <ExcelViewerModal
          fileName={previewFile.name}
          downloadUrl={previewFile.downloadUrl}
          onClose={onClose}
          onDownload={() => onDownload(previewFile)}
          canDownload={true}
          subtitle={
            selectedBackupType === 'census'
              ? 'Censo diario Hospital Hanga Roa'
              : 'Cierre CUDYR mensual Hospital Hanga Roa'
          }
        />
      </React.Suspense>
    );
  }

  return (
    <PdfViewerModal
      fileName={previewFile.name}
      url={previewFile.downloadUrl}
      onClose={onClose}
      onDownload={() => onDownload(previewFile)}
    />
  );
};
