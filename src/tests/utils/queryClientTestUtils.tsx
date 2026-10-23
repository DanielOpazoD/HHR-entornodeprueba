import {
  QueryClient,
  QueryClientProvider,
  type DefaultOptions,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { type ReactElement, type ReactNode } from 'react';
import { RepositoryProvider, createTestRepositoryContainer } from '@/services/RepositoryContext';
import { queryClient as appQueryClient } from '@/config/queryClient';

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

/**
 * The app's defaults, but refetching even fresh data on every tab return and reconnect: the
 * worst case a query's own refetch options must hold against.
 */
export const alwaysRefetchDefaults: DefaultOptions = {
  ...appQueryClient.getDefaultOptions(),
  queries: {
    ...appQueryClient.getDefaultOptions().queries,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
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
): {
  queryClient: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => ReactElement;
} => {
  const queryClient = options.queryClient ?? createTestQueryClient(options.config);
  const repositories = createTestRepositoryContainer();

  const wrapper = ({ children }: { children: ReactNode }) => {
    const repositoryWrappedChildren = (
      <RepositoryProvider value={repositories}>{children}</RepositoryProvider>
    );

    return (
      <QueryClientProvider client={queryClient}>
        {options.wrapChildren
          ? options.wrapChildren(repositoryWrappedChildren)
          : repositoryWrappedChildren}
      </QueryClientProvider>
    );
  };
  wrapper.displayName = 'QueryClientTestWrapper';

  return { queryClient, wrapper };
};
