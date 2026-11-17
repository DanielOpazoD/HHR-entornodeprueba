import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

const Draft = ({ patientId, painted }: { patientId: string; painted: string[] }) => {
  const [draft, setDraft] = useState('');
  if (useChangedOnRender([patientId])) setDraft(`borrador ${patientId}`);
  useEffect(() => {
    painted.push(draft);
  });
  return (
    <>
      <p>{draft}</p>
      <button onClick={() => setDraft('editado')}>editar</button>
    </>
  );
};

describe('useChangedOnRender', () => {
  it('sets state on mount and for a new patient before any stale draft is committed', () => {
    const painted: string[] = [];
    const { rerender } = render(<Draft patientId="A" painted={painted} />);
    fireEvent.click(screen.getByText('editar'));
    rerender(<Draft patientId="A" painted={painted} />);
    expect(screen.getByText('editado')).toBeInTheDocument();

    rerender(<Draft patientId="B" painted={painted} />);

    expect(screen.getByText('borrador B')).toBeInTheDocument();
    expect(painted).toEqual(['borrador A', 'editado', 'editado', 'borrador B']);
  });
});
