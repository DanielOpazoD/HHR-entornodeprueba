import React from 'react';
import clsx from 'clsx';

interface DateStripDropdownPanelProps {
  title: string;
  widthClassName: string;
  children: React.ReactNode;
}

export const DateStripDropdownPanel: React.FC<DateStripDropdownPanelProps> = ({
  title,
  widthClassName,
  children,
}) => (
  <div
    className={clsx(
      'absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200',
      widthClassName
    )}
  >
    <div className="px-3 py-2 border-b border-slate-100 mb-1">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{title}</p>
    </div>
    {children}
  </div>
);
