import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatientEmptyCell } from '@/features/census/components/patient-row/PatientEmptyCell';

describe('PatientEmptyCell', () => {
  it('renders default marker and base styles', () => {
    const { container } = render(
      <table>
        <tbody>
          <tr>
            <PatientEmptyCell tdClassName="w-20" />
          </tr>
        </tbody>
      </table>
    );

    expect(container.querySelector('td')).toHaveClass('w-20');
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('supports custom marker and content classes', () => {
    render(
      <table>
        <tbody>
          <tr>
            <PatientEmptyCell tdClassName="w-20" contentClassName="p-1" marker="N/A" />
          </tr>
        </tbody>
      </table>
    );

    const marker = screen.getByText('N/A');
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveClass('p-1');
  });
});
