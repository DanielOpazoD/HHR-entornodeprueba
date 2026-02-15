import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useDropdownMenu } from '@/hooks/useDropdownMenu';

const DropdownHarness = ({
  closeOnOutsideClick,
  closeOnEscape,
}: {
  closeOnOutsideClick?: boolean;
  closeOnEscape?: boolean;
}) => {
  const { isOpen, menuRef, toggle } = useDropdownMenu({ closeOnOutsideClick, closeOnEscape });

  return (
    <div>
      <button onClick={toggle}>toggle</button>
      <div ref={menuRef} data-testid="menu-root">
        {isOpen ? <span>open</span> : <span>closed</span>}
      </div>
      <button data-testid="outside">outside</button>
    </div>
  );
};

describe('useDropdownMenu', () => {
  it('toggles and closes on outside click', () => {
    render(<DropdownHarness />);

    expect(screen.getByText('closed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('open')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.getByText('closed')).toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    render(<DropdownHarness />);

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('open')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('closed')).toBeInTheDocument();
  });

  it('respects closeOnOutsideClick=false', () => {
    render(<DropdownHarness closeOnOutsideClick={false} />);

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByText('open')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.getByText('open')).toBeInTheDocument();
  });
});
