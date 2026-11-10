import { useState } from 'react';
import { History } from 'lucide-react';

import { ClinicalDocumentVersionHistory } from '@/features/clinical-documents/components/ClinicalDocumentVersionHistory';
import type {
  ClinicalDocumentVersionMeta,
  ClinicalDocumentVersionSectionSnapshot,
} from '@/domain/clinical-documents/entities';

interface ClinicalDocumentVersionBadgeProps {
  currentVersion: number;
  versionHistory: ClinicalDocumentVersionMeta[];
  canRestoreSection?: boolean;
  onRestoreSection?: (
    section: Pick<ClinicalDocumentVersionSectionSnapshot, 'sectionId' | 'title' | 'content'>
  ) => void;
}

export const ClinicalDocumentVersionBadge: React.FC<ClinicalDocumentVersionBadgeProps> = ({
  currentVersion,
  versionHistory,
  canRestoreSection = false,
  onRestoreSection,
}) => {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setShowHistory(true);
        }}
        className="flex items-center gap-0.5 text-[9px] font-mono text-slate-400 hover:text-medical-600 transition-colors"
        title="Ver historial de versiones"
      >
        <History size={9} />v{currentVersion}
      </button>
      {showHistory && (
        <ClinicalDocumentVersionHistory
          versions={versionHistory}
          currentVersion={currentVersion}
          canRestoreSection={canRestoreSection}
          onRestoreSection={onRestoreSection}
          onClose={() => setShowHistory(false)}
        />
      )}
    </>
  );
};
