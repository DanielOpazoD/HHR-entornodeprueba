import React, { lazy, Suspense } from 'react';
import { SectionErrorBoundary } from '@/components/shared/SectionErrorBoundary';

const RoleManagementPanel = lazy(() => import('./RoleManagementPanel'));

/** Account permissions are always administered against current server authority. */
export default function RoleManagementView() {
  return (
    <SectionErrorBoundary sectionName="administración de usuarios">
      <Suspense fallback={<p>Conectando con la administración de usuarios…</p>}>
        <RoleManagementPanel />
      </Suspense>
    </SectionErrorBoundary>
  );
}
