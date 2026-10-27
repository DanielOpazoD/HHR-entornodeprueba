import { CloudUpload } from 'lucide-react';
import React from 'react';

export const RayenSyncStatusLine: React.FC<{
  pending: boolean;
  onOpen: () => void;
  children: React.ReactNode;
}> = ({ pending, onOpen, children }) => (
  <div className="flex min-w-0 items-center gap-1">
    <div className="min-w-0 flex-1">{children}</div>
    {pending && (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Guardado pendiente · Ver detalle"
        title="Guardado pendiente · Ver detalle"
        className="shrink-0 rounded text-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600"
      >
        <CloudUpload size={13} aria-hidden="true" />
      </button>
    )}
  </div>
);
