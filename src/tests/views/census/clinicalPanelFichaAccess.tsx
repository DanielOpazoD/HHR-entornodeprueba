import React from 'react';

import { openClinicalPanel } from '@/features/census/components/patient-row/useActiveClinicalPanel';

/**
 * Places a panel where the census does: in the «Accesos» cell, beside the
 * manutara button whose ring opens it and that gets the focus back when it closes.
 */
export const FichaAccess: React.FC<{
  patientName: string;
  panelKey: string;
  children: React.ReactNode;
}> = ({ patientName, panelKey, children }) => (
  <table>
    <tbody>
      <tr>
        <td>
          <button
            type="button"
            data-clinical-access="menu"
            onClick={() => openClinicalPanel(panelKey)}
          >
            Abrir panel clínico de {patientName}
          </button>
          {children}
        </td>
      </tr>
    </tbody>
  </table>
);
