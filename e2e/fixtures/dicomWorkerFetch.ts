import type { Request, Route } from '@playwright/test';

type WorkerRoute = Pick<Route, 'fetch'> & { request(): Pick<Request, 'method'> };

/** Only the synthetic worker GET may recover transient connection resets. */
export const fetchDicomWorker = (route: WorkerRoute) =>
  route.fetch({ maxRetries: route.request().method() === 'GET' ? 2 : 0 });
