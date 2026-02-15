import React from 'react';
import { Trash2, ShieldAlert } from 'lucide-react';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { resolveActionHeaderState } from '@/features/census/controllers/censusActionHeaderController';

interface CensusActionHeaderCellProps {
  width: number;
  isEditMode: boolean;
  onResize: (width: number) => void;
  headerClassName: string;
  readOnly: boolean;
  canDeleteRecord: boolean;
  deniedMessage: string;
  onClearAll: () => Promise<void>;
}

export const CensusActionHeaderCell: React.FC<CensusActionHeaderCellProps> = ({
  width,
  isEditMode,
  onResize,
  headerClassName,
  readOnly,
  canDeleteRecord,
  deniedMessage,
  onClearAll,
}) => {
  const state = resolveActionHeaderState({
    readOnly,
    canDeleteRecord,
    deniedMessage,
  });

  return (
    <ResizableHeader
      width={width}
      isEditMode={isEditMode}
      onResize={onResize}
      className={`${headerClassName} print:hidden`}
    >
      {state.shouldRenderButton && (
        <button
          onClick={() => {
            void onClearAll();
          }}
          className={state.buttonClassName}
          title={state.title}
        >
          {state.icon === 'trash' ? <Trash2 size={12} /> : <ShieldAlert size={10} />}
        </button>
      )}
    </ResizableHeader>
  );
};
