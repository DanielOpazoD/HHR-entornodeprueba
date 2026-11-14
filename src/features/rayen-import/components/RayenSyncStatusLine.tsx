import { CloudUpload } from 'lucide-react';
import React from 'react';
import { SYNC_TONE, SYNC_TONE_ICON, type SyncToneLevel } from './syncTone';

export const RayenSyncStatusLine: React.FC<{
  /** Local save attention, by level; `null` hides the indicator. */
  pending: SyncToneLevel | null;
  onOpen: () => void;
  children: React.ReactNode;
}> = ({ pending, onOpen, children }) => {
  // Sends that stopped and will not resume alone take the action shape; the rest stay calm.
  const Icon = pending === 'action' ? SYNC_TONE_ICON.action : CloudUpload;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      {pending && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Guardado pendiente · Ver detalle"
          title={
            pending === 'action'
              ? 'Hay cambios sin enviar · Revisa el detalle'
              : 'Guardado pendiente · Ver detalle'
          }
          data-tone={pending}
          className={`shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 ${SYNC_TONE[pending].icon}`}
        >
          <Icon size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
