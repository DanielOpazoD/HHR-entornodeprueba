import React from 'react';

import { openClinicalPanel } from '@/features/census/components/patient-row/useActiveClinicalPanel';

/**
 * Places a panel where the census does: in the «Accesos» cell, beside the «Ficha clínica»
 * button that opens it and gets the focus back when it closes.
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
            data-clinical-access="ficha"
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
