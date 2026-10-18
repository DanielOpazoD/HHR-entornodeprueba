import React from 'react';
import { Hand, RotateCcw, Scan, ZoomIn } from 'lucide-react';
import type { DicomMode, DicomRuntime, DicomTool } from '@/services/radiology/dicomRuntimeTypes';

export const DicomNavigationTools: React.FC<{
  runtime: DicomRuntime | null;
  mode: DicomMode;
  activeTool: DicomTool;
  choose: (tool: DicomTool) => void;
  disabled: boolean;
}> = ({ runtime, mode, activeTool, choose, disabled }) => (
  <div className="dicom-button-group">
    {(
      [
        { id: 'window', label: 'Contraste (ventana y nivel)', icon: Scan },
        { id: 'pan', label: 'Mover', icon: Hand },
        { id: 'zoom', label: 'Zoom', icon: ZoomIn },
      ] as const
    ).map(tool => (
      <button
        type="button"
        key={tool.id}
        aria-label={tool.label}
        title={tool.label}
        aria-pressed={activeTool === tool.id}
        disabled={disabled || (mode === '3d' && tool.id === 'window')}
        onClick={() => {
          runtime?.tool(tool.id);
          choose(tool.id);
        }}
      >
        <tool.icon size={16} />
        {tool.id === 'window' && <span>Contraste</span>}
      </button>
    ))}
    {mode === '3d' && (
      <button
        type="button"
        aria-label="Rotar 3D"
        title="Rotar 3D"
        aria-pressed={activeTool === 'rotate'}
        disabled={disabled}
        onClick={() => {
          runtime?.tool('rotate');
          choose('rotate');
        }}
      >
        <RotateCcw size={16} />
      </button>
    )}
    <button
      type="button"
      title="Restablecer vista"
      aria-label="Restablecer vista"
      disabled={disabled}
      onClick={() => runtime?.reset()}
    >
      <RotateCcw size={16} />
    </button>
  </div>
);
