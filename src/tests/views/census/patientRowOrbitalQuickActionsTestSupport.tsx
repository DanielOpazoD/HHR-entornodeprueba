import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { PatientRowOrbitalQuickActions } from '@/features/census/components/patient-row/PatientRowOrbitalQuickActions';
import type {
  PatientRowOrbitalQuickActionCallbacks,
  PatientRowOrbitalQuickActionsAvailability,
} from '@/features/census/controllers/patientRowOrbitalQuickActionsController';

type RenderSingleRowOptions = Partial<PatientRowOrbitalQuickActionsAvailability> &
  PatientRowOrbitalQuickActionCallbacks;

interface RenderMultipleRowsOptions extends RenderSingleRowOptions {
  rows?: Array<{ testId: string; bedId: string }>;
}

export const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: '(hover: hover) and (pointer: fine)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
};

export const parsePx = (value: string): number => Number.parseFloat(value.replace('px', ''));

/** Laboratory, imaging and documents by default: three topics, as the layout tests measure. */
const OrbitalQuickActions: React.FC<RenderSingleRowOptions> = ({
  showClinicalPanelAction = false,
  showLaboratoryAction = true,
  showImagingAction = true,
  showClinicalDocumentsAction = true,
  showClinicalExplorerAction = false,
  onViewClinicalPanel = vi.fn(),
  onViewLaboratory = vi.fn(),
  onViewImaging = vi.fn(),
  onViewClinicalDocuments = vi.fn(),
  onOpenClinicalExplorer = vi.fn(),
}) => (
  <PatientRowOrbitalQuickActions
    showClinicalPanelAction={showClinicalPanelAction}
    showLaboratoryAction={showLaboratoryAction}
    showImagingAction={showImagingAction}
    showClinicalDocumentsAction={showClinicalDocumentsAction}
    showClinicalExplorerAction={showClinicalExplorerAction}
    onViewClinicalPanel={onViewClinicalPanel}
    onViewLaboratory={onViewLaboratory}
    onViewImaging={onViewImaging}
    onViewClinicalDocuments={onViewClinicalDocuments}
    onOpenClinicalExplorer={onOpenClinicalExplorer}
  />
);

export const renderSinglePatientRowOrbitalQuickActions = (options: RenderSingleRowOptions = {}) =>
  render(
    <table>
      <tbody>
        <tr className="group/patient-row" data-testid="patient-row">
          <td className="relative">
            <OrbitalQuickActions {...options} />
          </td>
        </tr>
      </tbody>
    </table>
  );

export const renderMultiPatientRowOrbitalQuickActions = ({
  rows = [
    { testId: 'patient-row', bedId: 'R2' },
    { testId: 'patient-row-secondary', bedId: 'R3' },
  ],
  ...options
}: RenderMultipleRowsOptions = {}) =>
  render(
    <table>
      <tbody>
        {rows.map(row => (
          <tr
            key={row.testId}
            className="group/patient-row"
            data-testid={row.testId}
            data-bed-id={row.bedId}
          >
            <td className="relative">
              <OrbitalQuickActions {...options} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
