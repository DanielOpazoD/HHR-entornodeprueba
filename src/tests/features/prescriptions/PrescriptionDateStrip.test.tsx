import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PrescriptionDateStrip } from '@/features/prescriptions/components/PrescriptionDateStrip';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const record: PrescriptionRecord = {
  id: 'fake-prescription',
  hospitalId: 'fake-hospital',
  prescriptionType: 'comun',
  image: {
    storagePath: 'fake/full.jpg',
    thumbnailStoragePath: 'fake/thumb.jpg',
    byteSize: 100,
    width: 10,
    height: 10,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'authenticated' },
  createdAt: '2026-10-25T04:30:00.000Z',
  expiresAt: '2026-11-24T04:30:00.000Z',
};

afterEach(() => vi.useRealTimers());

describe('PrescriptionDateStrip hospital calendar', () => {
  it('ends the strip on the hospital today at 23:30 on a Santiago device', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T04:30:00.000Z'));
    const onSelectDate = vi.fn();
    render(
      <PrescriptionDateStrip
        records={[]}
        selectedDate={null}
        onSelectDate={onSelectDate}
        daysBack={2}
      />
    );
    expect(screen.queryByRole('button', { name: 'dom 25 oct' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sáb 24 oct' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-24');
    expect(screen.getByRole('button', { name: 'vie 23 oct' })).toBeInTheDocument();
  });

  it('flags each backup on its hospital day, including instants after UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T17:00:00.000Z'));
    const onSelectDate = vi.fn();
    render(
      <PrescriptionDateStrip
        records={[record, { ...record, id: 'fake-invalid', createdAt: 'invalid' }]}
        selectedDate={null}
        onSelectDate={onSelectDate}
        daysBack={2}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'sáb 24 oct · con respaldos' }));
    expect(onSelectDate).toHaveBeenCalledWith('2026-10-24');
    expect(screen.getByRole('button', { name: 'dom 25 oct' })).toBeInTheDocument();
  });
});
