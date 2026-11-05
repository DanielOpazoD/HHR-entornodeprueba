import React from 'react';
import { Compass } from 'lucide-react';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { useClinicalExplorerLaunch } from './clinical-explorer/clinicalExplorerLaunch';

interface CensusActionHeaderCellProps {
  width: number;
  responsiveShare?: string;
  isEditMode: boolean;
  onResize: (width: number) => void;
  headerClassName: string;
}

/** Corner of the census table: opens the clinical explorer on the first patient of the day. */
export const CensusActionHeaderCell: React.FC<CensusActionHeaderCellProps> = ({
  width,
  responsiveShare,
  isEditMode,
  onResize,
  headerClassName,
}) => {
  const launchExplorer = useClinicalExplorerLaunch();

  return (
    <ResizableHeader
      width={width}
      responsiveShare={responsiveShare}
      isEditMode={isEditMode}
      onResize={onResize}
      className={`${headerClassName} print:hidden`}
    >
      <button
        type="button"
        onClick={() => launchExplorer?.()}
        disabled={!launchExplorer}
        aria-label="Abrir explorador clínico"
        title={
          launchExplorer
            ? 'Abrir explorador clínico'
            : 'Sin pacientes con RUT y episodio en este censo'
        }
        className="mx-auto block rounded-md p-1 text-slate-400 transition-colors hover:bg-teal-50 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
      >
        <Compass size={13} aria-hidden="true" />
      </button>
    </ResizableHeader>
  );
};
