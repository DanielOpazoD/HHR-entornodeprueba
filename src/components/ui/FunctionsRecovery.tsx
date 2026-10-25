import { lazy, Suspense } from 'react';

const Notice = lazy(() =>
  import('./FunctionsRecoveryNotice').catch(() => ({ default: () => null }))
);

export const FunctionsRecovery = () => (
  <Suspense fallback={null}>
    <Notice />
  </Suspense>
);
