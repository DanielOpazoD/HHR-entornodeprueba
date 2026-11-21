import { type ReactElement, type ReactNode } from 'react';
import {
  RepositoryProvider,
  createTestRepositoryContainer,
  type IRepositoryContainer,
} from '@/context/RepositoryContext';

export const createRepositoryTestWrapper = (
  overrides: Partial<IRepositoryContainer> = {}
): { wrapper: ({ children }: { children: ReactNode }) => ReactElement } => {
  const repositories = createTestRepositoryContainer(overrides);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <RepositoryProvider value={repositories}>{children}</RepositoryProvider>
  );
  wrapper.displayName = 'RepositoryTestWrapper';

  return { wrapper };
};
