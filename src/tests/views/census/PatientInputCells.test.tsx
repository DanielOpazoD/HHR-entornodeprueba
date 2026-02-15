import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientInputCells } from '@/features/census/components/patient-row/PatientInputCells';
import { DataFactory } from '@/tests/factories/DataFactory';
import { useDailyRecordStability } from '@/context/DailyRecordContext';

vi.mock('@/context/DailyRecordContext', () => ({
  useDailyRecordStability: vi.fn(),
}));

describe('PatientInputCells', () => {
  it('renders flag checkboxes from section composition', () => {
    vi.mocked(useDailyRecordStability).mockReturnValue({
      canEditField: () => true,
    } as unknown as ReturnType<typeof useDailyRecordStability>);

    const data = DataFactory.createMockPatient('R1');
    const textHandler = vi.fn();
    const onChange = {
      text: vi.fn().mockReturnValue(textHandler),
      check: vi.fn().mockReturnValue(vi.fn()),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    render(
      <table>
        <tbody>
          <tr>
            <PatientInputCells
              data={data}
              currentDateString="2026-02-15"
              onChange={onChange}
              onDemo={vi.fn()}
              readOnly={false}
              diagnosisMode="free"
            />
          </tr>
        </tbody>
      </table>
    );

    expect(screen.getByTitle('Comp. Qx')).toBeInTheDocument();
    expect(screen.getByTitle('UPC')).toBeInTheDocument();
  });
});
