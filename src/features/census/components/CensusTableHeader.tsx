import React from 'react';
import clsx from 'clsx';
import { ResizableHeader } from '@/components/ui/ResizableHeader';
import { CensusActionHeaderCell } from '@/features/census/components/CensusActionHeaderCell';
import { CensusResetDayMenuEntry } from '@/features/census/components/CensusResetDayMenuEntry';
import { CensusDiagnosisHeaderCell } from '@/features/census/components/CensusDiagnosisHeaderCell';
import { buildCensusHeaderCellModels } from '@/features/census/controllers/censusTableHeaderController';
import type { CensusTableHeaderProps } from '@/features/census/types/censusTableComponentContracts';
import { AlertsViewToggle } from '@/features/census/components/CensusViewToggles';
import { useNursingScalesVisible } from '@/features/census/hooks/useNursingScalesVisible';
import { useCensusViewPreferences } from '@/features/census/hooks/useCensusViewPreferences';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

/** Columns the «Alertas» view replaces with one cell, as `ClinicalAlertsViewCell` spans them. */
const ALERTS_VIEW_COLUMNS = ['admission', 'dmi', 'scores', 'upc'] as const;

export const CensusTableHeader: React.FC<CensusTableHeaderProps> = ({
  scoresAction,
  readOnly,
  columns,
  isEditMode,
  canDeleteRecord,
  resetDayDeniedMessage,
  onClearAll,
  diagnosisMode,
  accessProfile,
  onToggleDiagnosisMode,
  onResizeColumn,
}) => {
  const headerClassName =
    'sticky top-0 z-20 bg-slate-50 py-1.5 px-1.5 border-r border-slate-200/80 text-center text-slate-500 text-[10px] leading-none uppercase tracking-[0.04em] font-semibold';
  const headerCells = buildCensusHeaderCellModels(undefined, accessProfile);
  const visibleWidth =
    columns.actions + headerCells.reduce((sum, cell) => sum + columns[cell.key], 0);
  const responsiveShare = (width: number): string => `${(width / visibleWidth) * 100}%`;
  const view = useCensusViewPreferences();
  const nursingScalesVisible = useNursingScalesVisible();
  const canSwitchView = !isSpecialistCensusAccessProfile(accessProfile ?? 'default');
  const alertsView = view.alertsView && canSwitchView;
  const alertsWidth = ALERTS_VIEW_COLUMNS.reduce((sum, key) => sum + columns[key], 0);

  return (
    <thead className="sticky top-0 z-30">
      <CensusResetDayMenuEntry
        readOnly={readOnly}
        canDeleteRecord={accessProfile === 'specialist' ? false : canDeleteRecord}
        deniedMessage={resetDayDeniedMessage}
        onClearAll={onClearAll}
      />
      <tr className="border-b border-slate-200 print:static">
        <CensusActionHeaderCell
          width={columns.actions}
          responsiveShare={responsiveShare(columns.actions)}
          isEditMode={isEditMode}
          onResize={onResizeColumn('actions')}
          headerClassName={clsx(headerClassName, 'census-column-actions')}
        />

        {headerCells.map(cell =>
          alertsView && (ALERTS_VIEW_COLUMNS as readonly string[]).includes(cell.key) ? (
            cell.key === 'admission' && (
              <th
                key="alerts"
                colSpan={ALERTS_VIEW_COLUMNS.length}
                className={clsx(headerClassName, 'border-r-0')}
                style={
                  {
                    width: `${alertsWidth}px`,
                    '--census-column-share': responsiveShare(alertsWidth),
                  } as React.CSSProperties
                }
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span>Alertas de la ficha</span>
                  <AlertsViewToggle active />
                </span>
              </th>
            )
          ) : cell.kind === 'diagnosis' ? (
            <CensusDiagnosisHeaderCell
              key={cell.key}
              width={columns.diagnosis}
              responsiveShare={responsiveShare(columns.diagnosis)}
              isEditMode={isEditMode}
              onResize={onResizeColumn('diagnosis')}
              headerClassName={clsx(headerClassName, cell.className, `census-column-${cell.key}`)}
              readOnly={readOnly}
              diagnosisMode={diagnosisMode}
              onToggleDiagnosisMode={onToggleDiagnosisMode}
            />
          ) : (
            <ResizableHeader
              key={cell.key}
              width={columns[cell.key]}
              responsiveShare={responsiveShare(columns[cell.key])}
              isEditMode={isEditMode}
              onResize={onResizeColumn(cell.key)}
              className={clsx(headerClassName, cell.className, `census-column-${cell.key}`)}
              title={cell.title}
              ariaLabel={cell.key === 'status' ? 'Estado clínico' : undefined}
              minWidth={cell.key === 'status' ? 32 : undefined}
            >
              {cell.key === 'scores' && canSwitchView ? (
                <span className="inline-flex flex-wrap items-center justify-center gap-1">
                  <span>{cell.label}</span>
                  {/* The reapplication shortcut only counts Braden and Downton. */}
                  {nursingScalesVisible && scoresAction}
                  <AlertsViewToggle active={false} />
                </span>
              ) : (
                cell.label
              )}
            </ResizableHeader>
          )
        )}
      </tr>
    </thead>
  );
};
