import React from 'react';
import { CircleHelp } from 'lucide-react';

interface RayenImportErrorNoticeProps {
  error: string | null;
  isPreviewOpen: boolean;
}

export const RayenImportErrorNotice: React.FC<RayenImportErrorNoticeProps> = ({
  error,
  isPreviewOpen,
}) => {
  const [guidanceOpen, setGuidanceOpen] = React.useState(false);

  if (!error || isPreviewOpen) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-t border-amber-100 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-800"
      data-testid="rayen-import-error"
      role="status"
    >
      <CircleHelp size={14} aria-hidden="true" />
      Sincronización requiere revisión
      <button
        type="button"
        onClick={() => setGuidanceOpen(open => !open)}
        aria-expanded={guidanceOpen}
        aria-controls="rayen-import-error-guidance"
        className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600"
        title={error}
        aria-label={`Ver detalle de sincronización. ${error}`}
      >
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      {guidanceOpen && (
        <p
          id="rayen-import-error-guidance"
          className="basis-full border-t border-amber-100 pt-1 text-[11px] leading-relaxed text-amber-900"
        >
          {error}
        </p>
      )}
    </div>
  );
};
