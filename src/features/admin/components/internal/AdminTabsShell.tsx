import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

export interface AdminTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Icon color while the tab is not selected. */
  color: string;
  content: React.ReactNode;
}

interface AdminTabsShellProps {
  title: string;
  icon: LucideIcon;
  /** The first tab opens selected. */
  tabs: readonly AdminTab[];
  contentClassName?: string;
}

// The one frame of the admin pages with tabs: a sticky bar with the page title and its tabs,
// then the selected tab's content. Pages are only their list of tabs.
export const AdminTabsShell: React.FC<AdminTabsShellProps> = ({
  title,
  icon: TitleIcon,
  tabs,
  contentClassName,
}) => {
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id);
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  return (
    <div className="animate-fade-in font-sans pb-16">
      <div className="bg-white border-b border-slate-200 px-6 py-3 shadow-sm sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 pr-4 border-r border-slate-200">
            <TitleIcon size={16} className="text-slate-500" />
            <h1 className="text-sm font-bold text-slate-800">{title}</h1>
          </div>

          <div className="flex gap-1 flex-wrap">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5',
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <Icon size={13} className={isActive ? '' : tab.color} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={clsx('animate-in fade-in slide-in-from-bottom-4 duration-500', contentClassName)}
      >
        {/* Keyed by tab so switching tabs mounts the new content fresh, as each page did. */}
        {activeTab && <React.Fragment key={activeTab.id}>{activeTab.content}</React.Fragment>}
      </div>
    </div>
  );
};
