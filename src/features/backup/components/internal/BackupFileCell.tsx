/**
 * One backup calendar cell: view, download and (for those who may delete) delete a stored file.
 * Shared by the daily backup and handoff calendars; each passes its own tone and callbacks.
 */

import { Download, Trash2, Eye } from 'lucide-react';
import type { BaseStoredFile } from '@/types/backupArtifacts';

interface BackupFileCellProps<T extends BaseStoredFile> {
  file?: T;
  /** Background, hover and border classes of a cell that holds a file. */
  toneClassName: string;
  onDownload: (file: T) => void;
  onView: (file: T) => void;
  onDelete: (file: T) => void;
  canDelete: boolean;
  formatSize: (bytes: number) => string;
}

export const BackupFileCell = <T extends BaseStoredFile>({
  file,
  toneClassName,
  onDownload,
  onView,
  onDelete,
  canDelete,
  formatSize,
}: BackupFileCellProps<T>) => {
  if (!file) {
    return (
      <div className="flex items-center justify-center h-6">
        <span className="text-[10px] text-slate-300 italic">—</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded border ${toneClassName} transition-colors`}
    >
      <div className="flex items-center shrink-0">
        <button
          onClick={() => onView(file)}
          className="p-0.5 text-blue-600 hover:bg-blue-100 rounded transition-colors"
          title="Ver"
        >
          <Eye size={12} />
        </button>
        <button
          onClick={() => onDownload(file)}
          className="p-0.5 text-teal-600 hover:bg-teal-100 rounded transition-colors"
          title="Descargar"
        >
          <Download size={12} />
        </button>
        {canDelete && (
          <button
            onClick={() => onDelete(file)}
            className="p-0.5 text-red-500 hover:bg-red-100 rounded transition-colors"
            title="Eliminar"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {file.size && (
        <span className="text-[9px] text-slate-500 font-medium tabular-nums border-l border-slate-200 pl-1 ml-0.5">
          {formatSize(file.size)}
        </span>
      )}
    </div>
  );
};
