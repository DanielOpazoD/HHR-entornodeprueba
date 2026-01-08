/**
 * Navbar - Main navigation bar component
 * Refactored to use smaller, specialized sub-components.
 */

import React, { useRef, useState } from 'react';
import { WifiOff } from 'lucide-react';
import clsx from 'clsx';
import { useDailyRecordContext } from '../../context/DailyRecordContext';
import { useAuth } from '../../context/AuthContext';
import { getVisibleModules, isAdmin } from '../../utils/permissions';
import { NavbarMenu } from './NavbarMenu';
import { NavbarTabs } from './NavbarTabs';
import { UserMenu } from './UserMenu';
import { DemoModeBadge } from './DemoModeBadge';
import { SyncStatusIndicator } from './SyncStatusIndicator';

export type ModuleType = 'CENSUS' | 'CUDYR' | 'NURSING_HANDOFF' | 'MEDICAL_HANDOFF' | 'AUDIT' | 'WHATSAPP' | 'ERRORS' | 'TRANSFER_MANAGEMENT' | 'BACKUP_FILES' | 'DEV_DASHBOARD';
type ViewMode = 'REGISTER' | 'ANALYTICS';

interface NavbarProps {
  currentModule: ModuleType;
  setModule: (mod: ModuleType) => void;
  censusViewMode: ViewMode;
  setCensusViewMode: (mode: ViewMode) => void;
  onOpenBedManager: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenSettings: () => void;
  userEmail?: string | null;
  onLogout?: () => void;
  isFirebaseConnected?: boolean;
  isSharedMode?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentModule,
  setModule,
  censusViewMode,
  setCensusViewMode,
  onExportJSON,
  onImportJSON,
  onOpenSettings,
  userEmail,
  onLogout,
  isFirebaseConnected,
  isSharedMode = false
}) => {
  const { role } = useAuth();
  const visibleModules = getVisibleModules(role);
  const isUserAdmin = isAdmin(role);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleImportClick = () => {
    fileInputRef.current?.click();
    setIsMenuOpen(false);
  };

  const handleModuleChange = (mod: ModuleType) => {
    setModule(mod);
    if (mod === 'CENSUS') {
      setCensusViewMode('REGISTER');
    }
  };

  // Module Color Map
  const getNavColor = () => {
    switch (currentModule) {
      case 'CENSUS': return 'bg-medical-900 shadow-medical-900/20';
      case 'CUDYR': return 'bg-slate-500 shadow-slate-500/20';
      case 'NURSING_HANDOFF': return 'bg-sky-600 shadow-sky-600/20';
      case 'MEDICAL_HANDOFF': return 'bg-sky-600 shadow-sky-600/20';
      case 'AUDIT': return 'bg-slate-800 shadow-slate-800/20';
      case 'WHATSAPP': return 'bg-green-700 shadow-green-700/20';
      case 'ERRORS': return 'bg-slate-900 shadow-slate-900/20';
      default: return 'bg-medical-900 shadow-medical-900/20';
    }
  };

  return (
    <nav
      className={clsx(getNavColor(), "text-white shadow-md sticky top-0 z-[60] print:hidden transition-colors duration-300 h-[64px] flex items-center")}
      style={{ transform: 'translateZ(0)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 flex flex-wrap gap-4 justify-between items-center">

        {/* Brand with Dropdown Menu */}
        <NavbarMenu
          isOpen={isMenuOpen}
          onToggle={() => setIsMenuOpen(!isMenuOpen)}
          onClose={() => setIsMenuOpen(false)}
          currentModule={currentModule}
          setModule={setModule}
          censusViewMode={censusViewMode}
          setCensusViewMode={setCensusViewMode}
          onExportJSON={onExportJSON}
          onImportClick={handleImportClick}
          onOpenSettings={onOpenSettings}
          isUserAdmin={isUserAdmin}
          visibleModules={visibleModules}
          disabled={isSharedMode}
        />

        {!isSharedMode && (
          <>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".json,.csv"
              onChange={onImportJSON}
            />

            {/* Main Navigation Tabs */}
            <NavbarTabs
              currentModule={currentModule}
              onModuleChange={handleModuleChange}
              visibleModules={visibleModules}
            />
          </>
        )}

        {/* Status Indicators & User Menu */}
        <div className="flex items-center gap-4 py-2 ml-auto">
          <div className="flex items-center gap-3">
            {!isSharedMode && (
              <>
                <SyncStatusIndicator />
                <DemoModeBadge />
              </>
            )}

            {!isFirebaseConnected && (
              <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/20 border border-red-500/50 rounded-full text-red-200 text-xs font-bold uppercase tracking-wider">
                <WifiOff size={12} />
                OFFLINE
              </div>
            )}
          </div>

          {userEmail && onLogout && (
            <UserMenu
              userEmail={userEmail}
              role={role}
              onLogout={onLogout}
            />
          )}
        </div>
      </div>
    </nav>
  );
};
