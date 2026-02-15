import React from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface DateStripBookmarkToggleProps {
  onToggleBookmarks: () => void;
  showBookmarks?: boolean;
}

export const DateStripBookmarkToggle: React.FC<DateStripBookmarkToggleProps> = ({
  onToggleBookmarks,
  showBookmarks,
}) => (
  <button
    onClick={onToggleBookmarks}
    className={clsx(
      'p-1.5 rounded-lg transition-all shrink-0',
      showBookmarks ? 'text-medical-600 bg-medical-50' : 'text-slate-400 hover:bg-slate-100'
    )}
    title={showBookmarks ? 'Ocultar Marcadores' : 'Mostrar Marcadores'}
  >
    <ChevronDown
      size={16}
      className={clsx(
        'transition-transform duration-300',
        showBookmarks ? 'rotate-180 text-medical-600' : 'text-slate-400'
      )}
    />
  </button>
);
