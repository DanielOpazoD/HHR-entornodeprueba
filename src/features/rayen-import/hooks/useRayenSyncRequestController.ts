import { useCallback, useEffect, useState } from 'react';
import { createRayenSyncRequestController } from './rayenSyncRequestLifecycle';

/** Owns and cancels the single extension request associated with the mounted import flow. */
export const useRayenSyncRequestController = () => {
  const [controller] = useState(createRayenSyncRequestController);
  const cancel = useCallback(() => controller.cancel(), [controller]);
  useEffect(() => cancel, [cancel]);
  return { controller, cancel };
};
