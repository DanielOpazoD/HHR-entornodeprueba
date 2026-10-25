import { lazy, Suspense } from 'react';

const Notice = lazy(() => import('./FunctionsRecoveryNotice'));

export const FunctionsRecovery = () => (
  <Suspense fallback={null}>
    <Notice />
  </Suspense>
);
