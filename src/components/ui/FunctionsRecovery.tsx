import { lazy, Suspense, type ComponentType } from 'react';

const Notice = lazy<ComponentType>(() =>
  import('./FunctionsRecoveryNotice').catch(() => ({ default: () => null }))
);

export const FunctionsRecovery = () => (
  <Suspense fallback={null}>
    <Notice />
  </Suspense>
);
