import { createContext, useContext, useState, type ReactNode } from 'react';
import {
  defaultDailyRecordRepositoryPort,
  type DailyRecordRepositoryPort,
} from '@/application/ports/dailyRecordPort';
import { ICatalogRepository, CatalogRepository } from '@/services/repositories/CatalogRepository';

/**
 * Interface defining the set of repositories available in the application.
 */
export interface IRepositoryContainer {
  dailyRecord: DailyRecordRepositoryPort;
  catalog: ICatalogRepository;
}

const defaultRepositoryImplementations: IRepositoryContainer = {
  dailyRecord: defaultDailyRecordRepositoryPort,
  catalog: CatalogRepository,
};

export const createRepositoryContainer = (
  overrides: Partial<IRepositoryContainer> = {}
): IRepositoryContainer => ({
  ...defaultRepositoryImplementations,
  ...overrides,
});

export const createDefaultRepositoryContainer = (): IRepositoryContainer =>
  createRepositoryContainer();

export const createTestRepositoryContainer = (
  overrides: Partial<IRepositoryContainer> = {}
): IRepositoryContainer => createRepositoryContainer(overrides);

const RepositoryContext = createContext<IRepositoryContainer | undefined>(undefined);

/**
 * Hook to access the repository container.
 * This is the core of our Dependency Injection system.
 */
export const useRepositories = (): IRepositoryContainer => {
  const context = useContext(RepositoryContext);
  if (!context) {
    throw new Error('useRepositories must be used within a RepositoryProvider');
  }
  return context;
};

/** Optional variant for read-only detail dialogs that also mount in isolated unit tests. */
export const useOptionalRepositories = (): IRepositoryContainer | undefined =>
  useContext(RepositoryContext);

export const RepositoryProvider = RepositoryContext.Provider;

export const DefaultRepositoryProvider = ({ children }: { children: ReactNode }) => {
  const [repositories] = useState(createDefaultRepositoryContainer);

  return <RepositoryProvider value={repositories}>{children}</RepositoryProvider>;
};
