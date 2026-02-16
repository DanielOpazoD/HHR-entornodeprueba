import React from 'react';
import type { CensusMovementTableHeader } from '@/features/census/types/censusMovementTableTypes';
import type { CensusMovementSectionModel } from '@/features/census/types/censusMovementSectionModelTypes';
import { CensusMovementSectionLayout } from '@/features/census/components/CensusMovementSectionLayout';

interface CensusMovementSectionProps<TItem> {
  model: CensusMovementSectionModel<TItem>;
  title: string;
  emptyMessage: string;
  icon: React.ReactNode;
  iconClassName: string;
  headers: readonly CensusMovementTableHeader[];
  getItemKey: (item: TItem) => string;
  renderRow: (item: TItem) => React.ReactNode;
  subtitle?: string;
  rootClassName?: string;
  tableClassName?: string;
  bodyClassName?: string;
}

export const CensusMovementSection = <TItem,>({
  model,
  title,
  emptyMessage,
  icon,
  iconClassName,
  headers,
  getItemKey,
  renderRow,
  subtitle,
  rootClassName,
  tableClassName,
  bodyClassName,
}: CensusMovementSectionProps<TItem>): React.ReactElement | null => {
  if (!model.isRenderable) {
    return null;
  }

  return (
    <CensusMovementSectionLayout
      title={title}
      subtitle={subtitle}
      emptyMessage={emptyMessage}
      icon={icon}
      iconClassName={iconClassName}
      isEmpty={model.isEmpty}
      headers={headers}
      rootClassName={rootClassName}
      tableClassName={tableClassName}
      bodyClassName={bodyClassName}
    >
      {model.items.map(item => (
        <React.Fragment key={getItemKey(item)}>{renderRow(item)}</React.Fragment>
      ))}
    </CensusMovementSectionLayout>
  );
};
