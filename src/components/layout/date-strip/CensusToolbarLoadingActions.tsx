import { FolderOpen } from 'lucide-react';
import { DATE_STRIP_TRAILING_ACTION_BASE_CLASS } from '@/shared/ui/dateStripQuickActionStyles';
import { ClinicalConflictCenterButton } from '@/components/clinical-conflicts/ClinicalConflictCenterButton';
import { CensusOptionsMenu } from './CensusOptionsMenu';

// Presentation only: no document, conflict or clinical runtime is loaded by bootstrap.
export const ClinicalLibraryToolbarFallback = () => (
  <button
    type="button"
    disabled
    className={`${DATE_STRIP_TRAILING_ACTION_BASE_CLASS} text-slate-400`}
    aria-label="Documentos"
    title="Documentos y herramientas clínicas (cargando...)"
  >
    <FolderOpen size={15} />
    <span className="hidden md:inline">Documentos</span>
  </button>
);

export const CensusConflictToolbarFallback = () => (
  <ClinicalConflictCenterButton
    disabled
    scopeLabel="censo"
    snapshotCount={0}
    requiresAttention={false}
    testId="conflict-versions-loading"
    hideLabel
    label="Conflictos HHR"
    variant="quick-action"
    className="shrink-0 self-center"
  />
);

export const CensusToolbarLoadingActions = ({ role }: { role?: string }) => (
  <>
    <ClinicalLibraryToolbarFallback />
    <CensusOptionsMenu disabled />
    {role === 'admin' && <CensusConflictToolbarFallback />}
  </>
);
