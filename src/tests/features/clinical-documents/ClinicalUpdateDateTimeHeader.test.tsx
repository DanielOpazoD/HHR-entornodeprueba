import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalUpdateDateTimeHeader } from '@/features/clinical-documents/components/ClinicalUpdateDateTimeHeader';

describe('ClinicalUpdateDateTimeHeader', () => {
  it('renders date in DD/MM/YYYY display format with time', () => {
    render(
      <ClinicalUpdateDateTimeHeader
        sectionId="s-1"
        date="2026-04-17"
        time="08:30"
        canEdit={false}
      />
    );

    expect(screen.getByText(/17\/04\/2026, 08:30/)).toBeInTheDocument();
  });

  it('passes through malformed dates unchanged and omits the comma separator when time is missing', () => {
    render(<ClinicalUpdateDateTimeHeader sectionId="s-1" date="not-iso" canEdit={false} />);

    expect(screen.getByText('not-iso')).toBeInTheDocument();
  });

  it('renders an empty span when neither date nor time are provided', () => {
    const { container } = render(<ClinicalUpdateDateTimeHeader sectionId="s-1" canEdit={false} />);

    const span = container.querySelector('span');
    expect(span?.textContent).toBe('');
  });

  it('does not switch to edit mode when canEdit is false', () => {
    render(
      <ClinicalUpdateDateTimeHeader
        sectionId="s-1"
        date="2026-04-17"
        time="08:30"
        canEdit={false}
      />
    );

    fireEvent.click(screen.getByText(/17\/04\/2026/));
    expect(screen.queryByDisplayValue('2026-04-17')).not.toBeInTheDocument();
  });

  it('switches to edit mode on click when canEdit, and fires onPatchDate and onPatchTime', () => {
    const onPatchDate = vi.fn();
    const onPatchTime = vi.fn();

    render(
      <ClinicalUpdateDateTimeHeader
        sectionId="s-42"
        date="2026-04-17"
        time="08:30"
        canEdit
        onPatchDate={onPatchDate}
        onPatchTime={onPatchTime}
      />
    );

    fireEvent.click(screen.getByText(/17\/04\/2026/));

    const dateInput = screen.getByDisplayValue('2026-04-17') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-04-18' } });
    expect(onPatchDate).toHaveBeenCalledWith('s-42', '2026-04-18');

    const timeInput = screen.getByDisplayValue('08:30') as HTMLInputElement;
    fireEvent.change(timeInput, { target: { value: '09:15' } });
    expect(onPatchTime).toHaveBeenCalledWith('s-42', '09:15');
  });

  it('returns to display mode on blur', () => {
    render(<ClinicalUpdateDateTimeHeader sectionId="s-1" date="2026-04-17" time="08:30" canEdit />);

    fireEvent.click(screen.getByText(/17\/04\/2026/));
    const dateInput = screen.getByDisplayValue('2026-04-17');

    fireEvent.blur(dateInput);

    expect(screen.queryByDisplayValue('2026-04-17')).not.toBeInTheDocument();
    expect(screen.getByText(/17\/04\/2026/)).toBeInTheDocument();
  });
  it.each(['{Enter}', ' '])('opens date/time editing with %s after tabbing', async key => {
    const user = userEvent.setup();
    render(
      <ClinicalUpdateDateTimeHeader
        sectionId="synthetic-section"
        date="2026-04-17"
        time="08:30"
        canEdit
      />
    );
    await user.tab();
    expect(screen.getByRole('button', { name: /Editar fecha y hora/ })).toHaveFocus();
    await user.keyboard(key);
    expect(screen.getByLabelText('Fecha')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Hora')).toHaveFocus();
  });

  it('labels both date and time fields and preserves their section when editing', async () => {
    const user = userEvent.setup();
    const onPatchDate = vi.fn();
    const onPatchTime = vi.fn();
    render(
      <ClinicalUpdateDateTimeHeader
        sectionId="synthetic-section"
        date="2026-04-17"
        time="08:30"
        canEdit
        onPatchDate={onPatchDate}
        onPatchTime={onPatchTime}
      />
    );
    await user.click(screen.getByText('17/04/2026, 08:30'));
    fireEvent.change(screen.getByLabelText('Fecha'), { target: { value: '2026-04-18' } });
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '09:15' } });
    expect(onPatchDate).toHaveBeenCalledExactlyOnceWith('synthetic-section', '2026-04-18');
    expect(onPatchTime).toHaveBeenCalledExactlyOnceWith('synthetic-section', '09:15');
  });

  it('does not offer keyboard editing in read-only mode', async () => {
    const user = userEvent.setup();
    render(
      <ClinicalUpdateDateTimeHeader
        sectionId="synthetic-section"
        date="2026-04-17"
        time="08:30"
        canEdit={false}
      />
    );
    await user.tab();
    await user.keyboard('{Enter} ');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Fecha')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hora')).not.toBeInTheDocument();
  });
});
