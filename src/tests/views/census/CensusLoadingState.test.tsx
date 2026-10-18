import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CensusLoadingState } from '@/components/ui/CensusLoadingState';

describe('CensusLoadingState', () => {
  it('ships the original Manutara PNG without any modification', () => {
    expect(fs.readFileSync(path.resolve('public/images/rapanui/Manutara.png'))).toEqual(
      fs.readFileSync(path.resolve('Manutara.png'))
    );
  });
  it('shows only Cargando and a decorative rotating icon, without creation or a large card', () => {
    render(<CensusLoadingState />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status.textContent).toBe('Cargando');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(status.querySelector('img')).toHaveClass('census-manutara', 'h-24', 'w-24');
    expect(status.querySelector('img')).toHaveAttribute('src', '/images/rapanui/Manutara.png');
  });
});
