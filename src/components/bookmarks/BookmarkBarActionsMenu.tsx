import React from 'react';
import clsx from 'clsx';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Download,
  List,
  Settings2,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import type { BookmarkBarAlignment } from '@/components/bookmarks/controllers/bookmarkBarPreferencesController';

interface BookmarkBarActionsMenuProps {
  bookmarksCount: number;
  alignment: BookmarkBarAlignment;
  customOffset: number;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onOpenManager: () => void;
  onImport: () => void;
  onExport: () => void;
  onAlignmentChange: (alignment: BookmarkBarAlignment) => void;
  onCustomOffsetChange: (offset: number) => void;
}

export const BookmarkBarActionsMenu: React.FC<BookmarkBarActionsMenuProps> = ({
  bookmarksCount,
  alignment,
  customOffset,
  isOpen,
  onToggle,
  onClose,
  onOpenManager,
  onImport,
  onExport,
  onAlignmentChange,
  onCustomOffsetChange,
}) => {
  return (
    <div className="relative">
      <button
        onClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onToggle();
        }}
        className={clsx(
          'p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-50 rounded transition-all',
          isOpen && 'bg-white shadow-sm text-slate-900 border border-slate-100'
        )}
        title="Configuración"
      >
        <Settings2 size={14} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[60]"
            onClick={event => {
              event.stopPropagation();
              onClose();
            }}
          />
          <div className="absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-xl border border-slate-100 py-1 z-[70] animate-in fade-in slide-in-from-top-1 duration-150">
            <button
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onOpenManager();
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <List size={16} className="text-slate-400" />
              <span>Gestionar Marcadores</span>
            </button>

            <div className="h-px bg-slate-100 my-1" />

            <button
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onImport();
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Upload size={16} className="text-slate-400" />
              <span>Importar JSON</span>
            </button>
            <button
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onExport();
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Download size={16} className="text-slate-400" />
              <span>Exportar JSON</span>
            </button>

            <div className="h-px bg-slate-100 my-1" />

            <div className="px-4 py-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Posición
              </p>
              <div className="flex items-center gap-1 mb-2">
                <button
                  onClick={event => {
                    event.stopPropagation();
                    onAlignmentChange('left');
                  }}
                  className={clsx(
                    'p-1.5 rounded transition-all',
                    alignment === 'left'
                      ? 'bg-medical-100 text-medical-600'
                      : 'text-slate-400 hover:bg-slate-100'
                  )}
                  title="Izquierda"
                >
                  <AlignLeft size={14} />
                </button>
                <button
                  onClick={event => {
                    event.stopPropagation();
                    onAlignmentChange('center');
                  }}
                  className={clsx(
                    'p-1.5 rounded transition-all',
                    alignment === 'center'
                      ? 'bg-medical-100 text-medical-600'
                      : 'text-slate-400 hover:bg-slate-100'
                  )}
                  title="Centro"
                >
                  <AlignCenter size={14} />
                </button>
                <button
                  onClick={event => {
                    event.stopPropagation();
                    onAlignmentChange('right');
                  }}
                  className={clsx(
                    'p-1.5 rounded transition-all',
                    alignment === 'right'
                      ? 'bg-medical-100 text-medical-600'
                      : 'text-slate-400 hover:bg-slate-100'
                  )}
                  title="Derecha"
                >
                  <AlignRight size={14} />
                </button>
                <button
                  onClick={event => {
                    event.stopPropagation();
                    onAlignmentChange('custom');
                  }}
                  className={clsx(
                    'p-1.5 rounded transition-all',
                    alignment === 'custom'
                      ? 'bg-medical-100 text-medical-600'
                      : 'text-slate-400 hover:bg-slate-100'
                  )}
                  title="Personalizado"
                >
                  <SlidersHorizontal size={14} />
                </button>
              </div>
              {alignment === 'custom' && (
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max="80"
                    value={customOffset}
                    onChange={event => {
                      event.stopPropagation();
                      onCustomOffsetChange(parseInt(event.target.value, 10));
                    }}
                    onClick={event => event.stopPropagation()}
                    className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-medical-600"
                  />
                  <span className="text-[10px] text-slate-500 w-8 text-right">{customOffset}%</span>
                </div>
              )}
            </div>

            <div className="h-px bg-slate-100 my-1" />
            <div className="px-4 py-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                Total: {bookmarksCount} marcadores
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
