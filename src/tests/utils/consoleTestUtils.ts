import { vi } from 'vitest';

export type ConsoleMethod = 'error' | 'warn' | 'info' | 'debug' | 'log';

export const suppressConsole = (
    methods: ConsoleMethod[] = ['error', 'warn']
): Array<{ mockRestore: () => void }> => {
    return methods.map((method) =>
        vi.spyOn(console, method).mockImplementation(() => { })
    );
};

export const restoreConsole = (
    spies: Array<{ mockRestore: () => void }>
): void => {
    spies.forEach((spy) => {
        spy.mockRestore();
    });
};
