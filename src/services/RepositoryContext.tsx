import { createContext, useContext } from 'react';
import { IDailyRecordRepository, DailyRecordRepository } from './repositories/DailyRecordRepository';
import { ICatalogRepository, CatalogRepository } from './repositories/CatalogRepository';

/**
 * Interface defining the set of repositories available in the application.
 */
export interface IRepositoryContainer {
    dailyRecord: IDailyRecordRepository;
    catalog: ICatalogRepository;
}

/**
 * Default container using concrete implementations.
 */
export const defaultRepositories: IRepositoryContainer = {
    dailyRecord: DailyRecordRepository,
    catalog: CatalogRepository
};

const RepositoryContext = createContext<IRepositoryContainer | undefined>(undefined);

/**
 * Hook to access the repository container.
 * This is the core of our Dependency Injection system.
 */
export const useRepositories = () => {
    const context = useContext(RepositoryContext);
    if (!context) {
        // Fallback to default during development/tests if provider is missing
        return defaultRepositories;
    }
    return context;
};

export const RepositoryProvider = RepositoryContext.Provider;
