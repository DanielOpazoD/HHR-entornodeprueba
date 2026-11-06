import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

import { PatientRowOrbitalQuickActions } from '@/features/census/components/patient-row/PatientRowOrbitalQuickActions';

interface RenderSingleRowOptions {
  showClinicalDocumentsAction?: boolean;
  showExamRequestAction?: boolean;
  showImagingRequestAction?: boolean;
  onViewClinicalDocuments?: () => void;
  onViewExamRequest?: () => void;
  onViewImagingRequest?: () => void;
}

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

export const renderSinglePatientRowOrbitalQuickActions = ({
  showClinicalDocumentsAction = true,
  showExamRequestAction = true,
  showImagingRequestAction = true,
  onViewClinicalDocuments = vi.fn(),
  onViewExamRequest = vi.fn(),
  onViewImagingRequest = vi.fn(),
}: RenderSingleRowOptions = {}) =>
  render(
    <table>
      <tbody>
        <tr className="group/patient-row" data-testid="patient-row">
          <td className="relative">
            <PatientRowOrbitalQuickActions
              showClinicalDocumentsAction={showClinicalDocumentsAction}
              showExamRequestAction={showExamRequestAction}
              showImagingRequestAction={showImagingRequestAction}
              onViewClinicalDocuments={onViewClinicalDocuments}
              onViewExamRequest={onViewExamRequest}
              onViewImagingRequest={onViewImagingRequest}
            />
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
  showClinicalDocumentsAction = true,
  showExamRequestAction = true,
  showImagingRequestAction = true,
  onViewClinicalDocuments = vi.fn(),
  onViewExamRequest = vi.fn(),
  onViewImagingRequest = vi.fn(),
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
              <PatientRowOrbitalQuickActions
                showClinicalDocumentsAction={showClinicalDocumentsAction}
                showExamRequestAction={showExamRequestAction}
                showImagingRequestAction={showImagingRequestAction}
                onViewClinicalDocuments={onViewClinicalDocuments}
                onViewExamRequest={onViewExamRequest}
                onViewImagingRequest={onViewImagingRequest}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
