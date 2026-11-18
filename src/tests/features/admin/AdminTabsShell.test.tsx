import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BellRing, Database, MessageSquare } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { AdminTabsShell } from '@/features/admin/components/internal/AdminTabsShell';

const Counter: React.FC<{ name: string }> = ({ name }) => {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(value => value + 1)}>
      {name} {count}
    </button>
  );
};

const renderShell = (contentClassName?: string) =>
  render(
    <AdminTabsShell
      title="Comunicación"
      icon={MessageSquare}
      contentClassName={contentClassName}
      tabs={[
        {
          id: 'FIRST',
          label: 'Primera',
          icon: BellRing,
          color: 'text-amber-400',
          content: <Counter name="uno" />,
        },
        {
          id: 'SECOND',
          label: 'Segunda',
          icon: Database,
          color: 'text-sky-400',
          content: <Counter name="dos" />,
        },
      ]}
    />
  );

describe('AdminTabsShell', () => {
  it('shows the title and opens on the first tab', () => {
    renderShell();

    expect(screen.getByRole('heading', { level: 1, name: 'Comunicación' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Primera' })).toHaveClass('bg-slate-900');
    expect(screen.getByRole('button', { name: 'Segunda' })).not.toHaveClass('bg-slate-900');
    expect(screen.getByRole('button', { name: 'uno 0' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^dos/ })).not.toBeInTheDocument();
  });

  it('colors only the icons of the tabs that are not selected', () => {
    renderShell();

    const firstIcon = screen.getByRole('button', { name: 'Primera' }).querySelector('svg');
    const secondIcon = screen.getByRole('button', { name: 'Segunda' }).querySelector('svg');
    expect(firstIcon).not.toHaveClass('text-amber-400');
    expect(secondIcon).toHaveClass('text-sky-400');
  });

  it('switches content and starts the new tab fresh', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'uno 0' }));
    expect(screen.getByRole('button', { name: 'uno 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Segunda' }));
    expect(screen.getByRole('button', { name: 'dos 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Segunda' })).toHaveClass('bg-slate-900');

    await user.click(screen.getByRole('button', { name: 'Primera' }));
    expect(screen.getByRole('button', { name: 'uno 0' })).toBeInTheDocument();
  });

  it('adds the page layout classes to the content area', () => {
    renderShell('max-w-[1200px] mx-auto px-4 py-6');

    expect(screen.getByRole('button', { name: 'uno 0' }).parentElement).toHaveClass(
      'animate-in',
      'max-w-[1200px]',
      'px-4'
    );
  });
});
