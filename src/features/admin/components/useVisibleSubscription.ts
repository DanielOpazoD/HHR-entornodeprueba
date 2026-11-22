import { useEffect, useState } from 'react';
import { useLatestRef } from '@/hooks/useLatestRef';

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Live dashboards are typically left open in a background tab for the whole shift,
 * where every published report still costs a read. The listener is released while the
 * tab is hidden and re-subscribed on return, which also refetches the current picture.
 */
export const useVisibleSubscription = (subscribe: () => () => void): void => {
  const [visible, setVisible] = useState(isDocumentVisible);
  const subscribeRef = useLatestRef(subscribe);

  useEffect(() => {
    const sync = () => setVisible(isDocumentVisible());
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (!visible) return;
    return subscribeRef.current();
  }, [subscribeRef, visible]);
};
