import React from 'react';
import type { LabTrendGroup } from '@/types/domain/labAnalyticsTypes';
import { groupVariablesByScale } from './LabTrendChartHelpers';
import { UnitSubChart } from './LabTrendChartRenderers';

/** Render a trend group card -- splits into sub-charts per unit AND scale for readability. */
export const LabTrendGroupCard: React.FC<{
  group: LabTrendGroup;
  syncId: string;
  onActiveDateChange: (date: string) => void;
}> = ({ group, syncId, onActiveDateChange }) => {
  const unitGroups = groupVariablesByScale(group.variables);

  return (
    <div
      data-lab-trend-card
      className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-200/30"
    >
      <h4 className="mb-2 text-[14px] font-bold tracking-tight text-slate-800">{group.label}</h4>
      <div className="space-y-3">
        {unitGroups.map((unitGroup, index) => {
          const prevCount = unitGroups
            .slice(0, index)
            .reduce((sum, candidate) => sum + Object.keys(candidate.vars).length, 0);

          return (
            <UnitSubChart
              key={`${unitGroup.unit}-${index}`}
              varEntries={unitGroup.vars}
              unit={unitGroup.unit}
              colorOffset={prevCount}
              syncId={syncId}
              onActiveDateChange={onActiveDateChange}
            />
          );
        })}
      </div>
    </div>
  );
};
