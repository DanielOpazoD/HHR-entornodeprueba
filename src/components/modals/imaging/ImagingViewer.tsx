import React from 'react';
import { DocumentOption, ActiveTextMark } from './types';
import type { CustomMark } from '@/services/pdf/imagingRequestPdfService';
import type { PatientData } from '@/types/domain/patient';
import { buildImagingViewerDocumentModel } from '../controllers/imagingViewerController';
import { useManagedTimeout } from '@/hooks/useManagedTimeout';

interface ImagingViewerProps {
  selectedDoc: DocumentOption;
  patient: PatientData;
  debouncedPhysician: string;
  handleCanvasClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  marks: CustomMark[];
  setMarks: React.Dispatch<React.SetStateAction<CustomMark[]>>;
  activeText: ActiveTextMark | null;
  setActiveText: React.Dispatch<React.SetStateAction<ActiveTextMark | null>>;
}

export const ImagingViewer: React.FC<ImagingViewerProps> = ({
  selectedDoc,
  patient,
  debouncedPhysician,
  handleCanvasClick,
  marks,
  setMarks,
  activeText,
  setActiveText,
}) => {
  const viewerModel = buildImagingViewerDocumentModel(selectedDoc, patient, debouncedPhysician);
  const setManagedTimeout = useManagedTimeout();

  return (
    <div className="flex-1 bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="flex-1 relative bg-slate-200/50 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-4 py-6">
          <div
            className="relative w-full max-w-[720px] mx-auto bg-white shadow-xl rounded-sm overflow-hidden cursor-crosshair select-none"
            onClick={handleCanvasClick}
            style={{
              aspectRatio: viewerModel.aspectRatio,
            }}
          >
            <img
              src={viewerModel.imageSrc}
              alt="Base del Formulario"
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
            />

            {viewerModel.overlays.map((overlay, index) => (
              <div
                key={`${selectedDoc}-overlay-${index}`}
                className={[
                  'absolute font-sans text-xs sm:text-sm text-black pointer-events-none',
                  overlay.className || '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{ left: overlay.left, top: overlay.top }}
              >
                {overlay.text}
              </div>
            ))}

            {/* Active Text Input */}
            {activeText && (
              <input
                autoFocus
                type="text"
                value={activeText.text}
                onChange={e =>
                  setActiveText(prev => (prev ? { ...prev, text: e.target.value } : null))
                }
                onBlur={() => {
                  if (activeText.text.trim()) {
                    setMarks(prev => [
                      ...prev,
                      { x: activeText.x, y: activeText.y, text: activeText.text },
                    ]);
                  }
                  // Wait slightly so any consecutive click can register properly
                  setManagedTimeout(() => setActiveText(null), 100);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                // onClick propagation stop to prevent double triggering canvas wrap
                onClick={e => e.stopPropagation()}
                className="absolute font-sans text-xs sm:text-sm text-black bg-white/90 border-b border-blue-500 outline-none transform -translate-y-1/2 uppercase px-1 py-0.5 shadow-sm focus:ring-1 focus:ring-blue-500 rounded-sm z-20"
                style={{ left: `${activeText.x}%`, top: `${activeText.y}%`, width: '180px' }}
              />
            )}

            {/* Marks */}
            {marks.map((mark, i) => (
              <div
                key={i}
                className={`absolute pointer-events-none transform -translate-y-1/2 z-10 ${mark.text ? 'font-sans text-xs sm:text-sm text-black uppercase whitespace-nowrap' : '-translate-x-1/2 font-bold text-blue-700 flex items-center justify-center'}`}
                style={{
                  left: `${mark.x}%`,
                  top: `${mark.y}%`,
                  fontSize: mark.text ? undefined : '1.2rem',
                  lineHeight: 1,
                }}
              >
                {mark.text ? mark.text.toUpperCase() : 'X'}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
