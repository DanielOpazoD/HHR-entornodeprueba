import React from 'react';
import { RotateCcw, Pencil, Trash2 } from 'lucide-react';
import type { CensusMovementActionDescriptor } from '@/features/census/types/censusMovementActionTypes';

interface CensusMovementActionsCellProps {
    actions: CensusMovementActionDescriptor[];
}

const renderActionIcon = (kind: CensusMovementActionDescriptor['kind']): React.ReactNode => {
    if (kind === 'undo') {
        return <RotateCcw size={14} />;
    }
    if (kind === 'edit') {
        return <Pencil size={14} />;
    }
    return <Trash2 size={14} />;
};

export const CensusMovementActionsCell: React.FC<CensusMovementActionsCellProps> = ({
    actions
}) => {
    return (
        <td className="p-2 flex justify-end gap-2 print:hidden">
            {actions.map((action) => (
                <button
                    key={action.kind}
                    onClick={action.onClick}
                    className={action.className}
                    title={action.title}
                >
                    {renderActionIcon(action.kind)}
                </button>
            ))}
        </td>
    );
};
