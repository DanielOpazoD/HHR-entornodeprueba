import React from 'react';
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { CensusBootstrapRecovery } from '@/features/census/components/CensusBootstrapRecovery';
import { queryKeys } from '@/config/queryClient';

vi.mock('@/components/ui/CensusLoadingState', () => ({
  CensusLoadingState: () => <p>Comprobando</p>,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = (read: () => Promise<string>, failed = false) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const View = () => {
    const query = useQuery({ queryKey: queryKeys.dailyRecord.byDate('2026-10-19'), queryFn: read });
    if (query.data === 'confirmed_empty' && !query.isFetching && !query.isError)
      return <button>Copiar</button>;
    if (query.data === 'record') return <p>Censo existente</p>;
    return <CensusBootstrapRecovery date="2026-10-19" failed={failed || query.isError} />;
  };
  render(
    <QueryClientProvider client={client}>
      <View />
    </QueryClientProvider>
  );
  return client;
};
const advance = async (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

it('bounds a hung read, cancels it on retry, and unlocks only after confirmed absence', async () => {
  vi.useFakeTimers();
  let finishOld!: (value: string) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          finishOld = resolve;
        })
    )
    .mockResolvedValueOnce('confirmed_empty');
  const client = mount(read);
  client.setQueryData(['unrelated'], 'preserve');
  await advance(15_000);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByText('Copiar')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await advance(10);
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Copiar')).toBeInTheDocument();
  await act(async () => finishOld('record'));
  await advance(10);
  expect(screen.getByText('Copiar')).toBeInTheDocument();
  expect(client.getQueryData(['unrelated'])).toBe('preserve');
  client.clear();
});

it('keeps copying blocked after failure and after a retry that never settles', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementation(() => new Promise(() => {}));
  const client = mount(read);
  await advance(10);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await advance(1);
  expect(screen.getByText('Comprobando')).toBeInTheDocument();
  await advance(15_000);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(screen.queryByText('Copiar')).not.toBeInTheDocument();
  client.clear();
});

it('shows an arriving record instead of creation after retry', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce('record');
  const client = mount(read);
  await advance(10);
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await advance(10);
  expect(screen.getByText('Censo existente')).toBeInTheDocument();
  expect(screen.queryByText('Copiar')).not.toBeInTheDocument();
  client.clear();
});
