/**
 * Backup UI Components
 * Google Drive style folder cards and breadcrumbs
 */

import React from 'react';
import { Folder, ChevronRight } from 'lucide-react';

// ============= Folder Card =============

interface FolderCardProps {
  name: string;
  onClick: () => void;
  itemCount?: number;
}

export const FolderCard: React.FC<FolderCardProps> = ({ name, onClick, itemCount }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-teal-300 hover:shadow-sm transition-all text-left group"
  >
    <div className="p-2 bg-teal-50 text-teal-600 rounded-lg group-hover:bg-teal-100 transition-colors">
      <Folder size={20} fill="currentColor" fillOpacity={0.2} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="font-medium text-slate-700 truncate">{name}</p>
      {itemCount !== undefined && <p className="text-xs text-slate-400">{itemCount} elementos</p>}
    </div>
    <ChevronRight
      size={16}
      className="text-slate-300 group-hover:text-teal-400 transition-colors"
    />
  </button>
);

// ============= Breadcrumbs =============

interface BreadcrumbsProps {
  path: string[];
  onNavigate: (index: number) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ path, onNavigate }) => (
  <nav className="flex items-center gap-1 text-sm text-slate-500 mb-4 overflow-x-auto whitespace-nowrap pb-2 scrollbar-none">
    <button
      onClick={() => onNavigate(-1)}
      className="hover:text-teal-600 font-medium transition-colors"
    >
      Inicio
    </button>
    {path.map((item, index) => (
      <React.Fragment key={index}>
        <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
        <button
          onClick={() => onNavigate(index)}
          className={`hover:text-teal-600 font-medium transition-colors ${
            index === path.length - 1 ? 'text-teal-600' : ''
          }`}
        >
          {item}
        </button>
      </React.Fragment>
    ))}
  </nav>
);
