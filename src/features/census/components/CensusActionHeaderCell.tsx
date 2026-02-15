import React from 'react';
import clsx from 'clsx';
import { Trash2, ShieldAlert } from 'lucide-react';
import { ResizableHeader } from '@/components/ui/ResizableHeader';

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
    onClearAll
}) => {
    return (
        <ResizableHeader
            width={width}
            isEditMode={isEditMode}
            onResize={onResize}
            className={clsx(headerClassName, 'print:hidden')}
        >
            {(!readOnly || canDeleteRecord) && (
                <button
                    onClick={() => {
                        void onClearAll();
                    }}
                    className={clsx(
                        'p-1 rounded-md transition-all mx-auto block',
                        canDeleteRecord
                            ? 'bg-slate-500/10 hover:bg-rose-500/20 text-slate-400 hover:text-rose-600'
                            : 'bg-slate-100 text-slate-300 cursor-not-allowed opacity-50'
                    )}
                    title={canDeleteRecord ? 'Limpiar todos los datos del día' : deniedMessage}
                >
                    {canDeleteRecord ? <Trash2 size={12} /> : <ShieldAlert size={10} />}
                </button>
            )}
        </ResizableHeader>
    );
};
