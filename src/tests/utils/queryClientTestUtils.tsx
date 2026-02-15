import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import { type ReactElement, type ReactNode } from 'react';

interface QueryClientTestWrapperOptions {
    config?: QueryClientConfig;
    queryClient?: QueryClient;
    wrapChildren?: (children: ReactNode) => ReactNode;
}

const DEFAULT_QUERY_CLIENT_CONFIG: QueryClientConfig = {
    defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
    },
};

export const createTestQueryClient = (config: QueryClientConfig = {}): QueryClient => {
    const defaultOptions = {
        ...DEFAULT_QUERY_CLIENT_CONFIG.defaultOptions,
        ...config.defaultOptions,
        queries: {
            ...DEFAULT_QUERY_CLIENT_CONFIG.defaultOptions?.queries,
            ...config.defaultOptions?.queries,
        },
        mutations: {
            ...DEFAULT_QUERY_CLIENT_CONFIG.defaultOptions?.mutations,
            ...config.defaultOptions?.mutations,
        },
    };

    return new QueryClient({
        ...DEFAULT_QUERY_CLIENT_CONFIG,
        ...config,
        defaultOptions,
    });
};

export const createQueryClientTestWrapper = (
    options: QueryClientTestWrapperOptions = {}
): { queryClient: QueryClient; wrapper: ({ children }: { children: ReactNode }) => ReactElement } => {
    const queryClient = options.queryClient ?? createTestQueryClient(options.config);

    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            {options.wrapChildren ? options.wrapChildren(children) : children}
        </QueryClientProvider>
    );
    wrapper.displayName = 'QueryClientTestWrapper';

    return { queryClient, wrapper };
};
