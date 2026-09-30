import React from 'react';
import { Copy } from 'lucide-react';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { rayenSyncCensusHref } from './rayenSyncIssueSupport';
import { formatRayenSyncTargetDate } from './rayenSyncPresentation';

interface RayenSyncIssueActionsProps {
  code: string;
  date?: string | null;
  bedId?: string | null;
}

export const RayenSyncIssueActions: React.FC<RayenSyncIssueActionsProps> = ({
  code,
  date,
  bedId,
}) => {
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const href = rayenSyncCensusHref(date, bedId);
  const copyCode = async () => {
    try {
      await writeClipboardText(code);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {href && (
        <a
          href={href}
          className="rounded font-semibold text-teal-800 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
        >
          {bedId ? `Ver cama ${bedId}` : 'Ver censo'} · {formatRayenSyncTargetDate(date)}
        </a>
      )}
      <span className="min-w-0 text-slate-600">
        Código técnico: <code className="break-all select-text">{code}</code>
      </span>
      <button
        type="button"
        onClick={() => void copyCode()}
        aria-label={`Copiar código ${code}`}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold text-slate-700 hover:bg-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <Copy size={12} aria-hidden="true" /> Copiar código
      </button>
      <span role="status" className="text-slate-600">
        {copyState === 'copied'
          ? 'Código copiado'
          : copyState === 'failed'
            ? 'Selecciona el código para copiarlo.'
            : ''}
      </span>
    </div>
  );
};
