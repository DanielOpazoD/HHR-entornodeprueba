// Public API for code outside the cudyr feature. Internal consumers should import local modules directly.
// Keep the optional monthly reader in its own on-demand chunk.
import { createElement, lazy } from 'react';
import type { ComponentProps } from 'react';
const LazyCudyrView = lazy(() =>
  import('./components/CudyrView').then(module => ({ default: module.CudyrView }))
);
const LazyMonthlyIndicator = lazy(() =>
  import('./components/CudyrMonthlyIndicator').then(module => ({
    default: module.CudyrMonthlyIndicator,
  }))
);
// Public consumers also use lazyWithRetry; return functions rather than nested lazy objects.
export const CudyrView = (props: ComponentProps<typeof LazyCudyrView>) =>
  createElement(LazyCudyrView, props);
export const CudyrMonthlyIndicator = (props: ComponentProps<typeof LazyMonthlyIndicator>) =>
  createElement(LazyMonthlyIndicator, props);
export { getCategorization, getCategoryColor } from '@/services/cudyr/CudyrScoreUtils';
export {
  CUDYR_NIGHT_REFERENCE_TIME_LABEL,
  isCudyrPatientEligible,
  resolveCudyrNightApplicationDate,
} from './controllers/cudyrEligibilityController';
