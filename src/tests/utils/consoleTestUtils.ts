import { vi } from 'vitest';

export type ConsoleMethod = 'error' | 'warn' | 'info' | 'debug' | 'log';
export type RestorableSpy = { mockRestore: () => void };

export const suppressConsole = (methods: ConsoleMethod[] = ['error', 'warn']): RestorableSpy[] => {
  return methods.map(method => vi.spyOn(console, method).mockImplementation(() => {}));
};

export const restoreConsole = (spies: RestorableSpy[]): void => {
  spies.forEach(spy => {
    spy.mockRestore();
  });
};

export const suppressProcessStdout = (): RestorableSpy =>
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
