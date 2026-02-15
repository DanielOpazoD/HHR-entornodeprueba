/**
 * SharedCensusView
 *
 * View for external users (invited guests) to access census files.
 * Displays the most recent file from current month and last file from previous month.
 */

import React from 'react';
import { useSharedCensusFiles } from '@/hooks/useSharedCensusFiles';
import { CensusAccessUser } from '@/types/censusAccess';
import { ExcelViewerModal } from '@/components/shared/ExcelViewerModal';
import {
  resolveSharedCensusAccessDisplayName,
  resolveSharedCensusViewState,
} from '@/features/census/controllers/sharedCensusViewController';
import {
  SharedCensusDeniedState,
  SharedCensusEmptyState,
  SharedCensusFileCard,
  SharedCensusFooter,
  SharedCensusHeader,
  SharedCensusLoadErrorState,
  SharedCensusLoadingState,
} from '@/features/census/components/shared-census';

interface SharedCensusViewProps {
  accessUser: CensusAccessUser | null;
  error: string | null;
}

export const SharedCensusView: React.FC<SharedCensusViewProps> = ({ accessUser, error }) => {
  const {
    filteredFiles,
    isLoading,
    loadError,
    searchTerm,
    setSearchTerm,
    selectedFile,
    setSelectedFile,
    handlers,
  } = useSharedCensusFiles(accessUser);

  const viewState = resolveSharedCensusViewState({
    error,
    accessUser,
    isLoading,
  });

  if (viewState === 'denied') {
    return <SharedCensusDeniedState error={error} />;
  }

  if (viewState === 'loading') {
    return <SharedCensusLoadingState />;
  }

  if (!accessUser) {
    return null;
  }

  const accessDisplayName = resolveSharedCensusAccessDisplayName(accessUser);
  const canDownload = accessUser.role === 'downloader';
  const hasSearchTerm = searchTerm.trim().length > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SharedCensusHeader
        accessDisplayName={accessDisplayName}
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
      />

      {loadError ? (
        <SharedCensusLoadErrorState loadError={loadError} />
      ) : filteredFiles.length === 0 ? (
        <SharedCensusEmptyState hasSearchTerm={hasSearchTerm} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {filteredFiles.map(file => (
            <SharedCensusFileCard
              key={file.fullPath}
              file={file}
              canDownload={canDownload}
              onViewFile={handlers.handleViewFile}
              onDownloadFile={handlers.handleDownload}
            />
          ))}
        </div>
      )}

      {selectedFile && (
        <ExcelViewerModal
          fileName={selectedFile.name.split(' - ')[0]}
          downloadUrl={selectedFile.downloadUrl}
          canDownload={canDownload}
          onClose={() => setSelectedFile(null)}
          onDownload={() => handlers.handleDownload(selectedFile)}
        />
      )}

      <SharedCensusFooter />
    </div>
  );
};
