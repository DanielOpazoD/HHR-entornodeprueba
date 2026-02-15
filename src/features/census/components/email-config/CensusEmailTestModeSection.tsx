import React from 'react';

interface CensusEmailTestModeSectionProps {
  isAdminUser: boolean;
  testModeEnabled: boolean;
  onTestModeChange: (enabled: boolean) => void;
  testRecipient: string;
  onTestRecipientChange: (value: string) => void;
}

export const CensusEmailTestModeSection: React.FC<CensusEmailTestModeSectionProps> = ({
  isAdminUser,
  testModeEnabled,
  onTestModeChange,
  testRecipient,
  onTestRecipientChange,
}) => {
  if (!isAdminUser) {
    return null;
  }

  return (
    <div className="border border-blue-100 bg-blue-50/30 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
            Modo Prueba
          </h4>
          <p className="text-[9px] text-blue-600/80 font-medium">Solo a cuenta de validación.</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={testModeEnabled}
            onChange={event => onTestModeChange(event.target.checked)}
            className="sr-only peer"
          />
          <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
      {testModeEnabled && (
        <div className="animate-in slide-in-from-top-1 duration-200">
          <input
            type="email"
            placeholder="correo.prueba@hospital.cl"
            value={testRecipient}
            onChange={event => onTestRecipientChange(event.target.value)}
            className="w-full border border-blue-200 rounded-lg px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-inner"
          />
        </div>
      )}
    </div>
  );
};
