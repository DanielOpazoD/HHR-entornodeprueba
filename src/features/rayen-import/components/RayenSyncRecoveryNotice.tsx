import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { RayenSyncRecoveryPresentation } from './rayenSyncRecoveryPresentation';
import { SYNC_TONE, SYNC_TONE_ICON } from './syncTone';

interface RayenSyncRecoveryNoticeProps {
  presentation: RayenSyncRecoveryPresentation | null;
  busy: boolean;
  onAction: () => void;
}

export const RayenSyncRecoveryNotice: React.FC<RayenSyncRecoveryNoticeProps> = ({
  presentation,
  busy,
  onAction,
}) => {
  if (!presentation) return null;

  const tone = SYNC_TONE[presentation.level];
  // Informative recovery (a run or check in progress) carries no warning icon.
  const Icon = presentation.level === 'review' ? SYNC_TONE_ICON.review : null;

  return (
    <div
      className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${tone.surface}`}
      data-testid="rayen-sync-recovery-notice"
      data-tone={presentation.level}
      role="region"
      aria-label="Recuperación de sincronización"
    >
      <div className="flex min-w-0 items-start gap-2">
        {Icon && <Icon className={`mt-0.5 shrink-0 ${tone.icon}`} size={15} aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-xs font-bold">{presentation.title}</p>
          <p className="mt-0.5 text-[11px] font-medium">{presentation.detail}</p>
        </div>
      </div>
      {presentation.action && presentation.actionLabel && (
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-current/20 bg-white/80 px-2.5 py-1.5 text-xs font-bold shadow-sm transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-progress disabled:opacity-60"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
          {presentation.actionLabel}
        </button>
      )}
    </div>
  );
};
