import React from 'react';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { CensusMovementActionViewModel } from '@/features/census/hooks/useCensusMovementActionsCellModel';

interface CensusMovementActionButtonProps {
  action: CensusMovementActionViewModel;
}

const renderIcon = (iconName: CensusMovementActionViewModel['iconName']) => {
  if (iconName === 'undo') return <RotateCcw size={14} />;
  if (iconName === 'edit') return <Pencil size={14} />;
  return <Trash2 size={14} />;
};

export const CensusMovementActionButton: React.FC<CensusMovementActionButtonProps> = ({
  action,
}) => (
  <button onClick={action.onClick} className={action.className} title={action.title}>
    {renderIcon(action.iconName)}
  </button>
);
