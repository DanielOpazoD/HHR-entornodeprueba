import React from 'react';
import clsx from 'clsx';
import { Clock, Download, Eye, FileSpreadsheet, ShieldCheck } from 'lucide-react';
import { formatFileSize } from '@/services/backup/baseStorageService';
import type { StoredCensusFile } from '@/services/backup/censusStorageService';
import { buildSharedCensusFileCardModel } from '@/features/census/controllers/sharedCensusViewController';

interface SharedCensusFileCardProps {
  file: StoredCensusFile;
  canDownload: boolean;
  onViewFile: (file: StoredCensusFile) => void;
  onDownloadFile: (file: StoredCensusFile) => void;
}

export const SharedCensusFileCard: React.FC<SharedCensusFileCardProps> = ({
  file,
  canDownload,
  onViewFile,
  onDownloadFile,
}) => {
  const fileCardModel = buildSharedCensusFileCardModel(file);

  return (
    <div
      className={clsx(
        'group bg-white rounded-3xl border p-6 transition-all flex flex-col justify-between relative overflow-hidden',
        fileCardModel.isCurrentMonth
          ? 'border-medical-200 shadow-xl shadow-medical-100/20 ring-1 ring-medical-50'
          : 'border-slate-200 shadow-sm opacity-90'
      )}
    >
      {fileCardModel.isCurrentMonth && (
        <div className="absolute top-0 right-0 px-4 py-1.5 bg-medical-500 text-white text-[9px] font-black uppercase tracking-widest rounded-bl-xl shadow-sm">
          Más Reciente
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div
          className={clsx(
            'w-14 h-14 rounded-2xl flex items-center justify-center border transition-all duration-300 group-hover:scale-110 group-hover:rotate-3',
            fileCardModel.isCurrentMonth
              ? 'bg-medical-50 text-medical-600 border-medical-100'
              : 'bg-slate-50 text-slate-500 border-slate-100'
          )}
        >
          <FileSpreadsheet size={28} />
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">
            Censo Cerrado
          </p>
          <div className="flex items-center justify-end gap-1.5 text-slate-400">
            <ShieldCheck size={12} className="text-green-500" />
            <span className="text-[10px] font-black tracking-tight">
              {formatFileSize(file.size)}
            </span>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <h3 className="text-xl font-black text-slate-900 mb-1 tracking-tight">
          {fileCardModel.monthName} {fileCardModel.year}
        </h3>
        <div className="flex items-center gap-2 text-slate-500">
          <Clock size={14} className="text-slate-300" />
          <span className="text-sm font-bold">
            Corte: {fileCardModel.day} de {fileCardModel.monthName}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onViewFile(file)}
          className={clsx(
            'flex-1 font-black py-3 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 active:scale-95 border shadow-sm',
            fileCardModel.isCurrentMonth
              ? 'bg-medical-600 hover:bg-medical-700 text-white border-medical-500 hover:shadow-lg hover:shadow-medical-200'
              : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
          )}
        >
          <Eye size={18} />
          Visualizar Censo
        </button>

        {canDownload && (
          <button
            onClick={() => onDownloadFile(file)}
            className="w-12 h-12 bg-white hover:bg-slate-50 text-slate-500 font-bold rounded-xl text-sm transition-all flex items-center justify-center border border-slate-200 shadow-sm active:scale-95 hover:text-medical-600 hover:border-medical-200"
            title="Descargar"
          >
            <Download size={20} />
          </button>
        )}
      </div>
    </div>
  );
};
