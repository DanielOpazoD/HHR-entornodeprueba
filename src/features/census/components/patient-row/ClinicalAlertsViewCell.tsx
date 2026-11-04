/**
 * «Alertas» view of the census: one cell in place of Signos, DMI, Scores and UPC with the three
 * newest chart alerts, date and message only. Clicking opens every alert with its time.
 */

import React, { useState } from 'react';
import type { BaseCellProps } from './inputCellTypes';
import { ClinicalAlertsDetail } from './ClinicalAlertsDetail';
import { clinicalAlertStamp } from './clinicalAlertStamp';

/** Signos, DMI, Scores and UPC. */
export const ALERTS_VIEW_COLUMN_SPAN = 4;
const VISIBLE_ALERTS = 3;

export const ClinicalAlertsViewCell: React.FC<BaseCellProps> = ({ data, isEmpty = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const alerts = isEmpty ? [] : (data.clinicalAlerts ?? []);
  const hidden = alerts.length - VISIBLE_ALERTS;

  return (
    <td colSpan={ALERTS_VIEW_COLUMN_SPAN} className="py-0.5 px-1.5 align-top">
      {alerts.length > 0 ? (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setIsOpen(true);
          }}
          className="block w-full cursor-pointer rounded text-left hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700"
          aria-label={`Ver ${alerts.length === 1 ? 'la alerta' : `las ${alerts.length} alertas`} de la ficha`}
          data-testid="clinical-alerts-view"
        >
          {alerts.slice(0, VISIBLE_ALERTS).map(alert => (
            <span key={alert.id} className="flex gap-1.5 text-[11px] leading-snug">
              <span className="shrink-0 tabular-nums text-slate-500">
                {clinicalAlertStamp(alert.recordedAt).short}
              </span>
              <span className="line-clamp-2 break-words text-slate-800">{alert.text}</span>
            </span>
          ))}
          {hidden > 0 && (
            <span className="block text-[9px] font-semibold text-amber-700">+{hidden} más</span>
          )}
        </button>
      ) : (
        !isEmpty && <div className="text-center text-[9px] text-slate-300 select-none">—</div>
      )}
      {isOpen && (
        <ClinicalAlertsDetail
          patientName={data.patientName}
          alerts={alerts}
          onClose={() => setIsOpen(false)}
        />
      )}
    </td>
  );
};
