import { useEffect, useState } from 'react';

const isDocumentVisible = () =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * Live dashboards are typically left open in a background tab for the whole shift,
 * where every published report still costs a read. The listener is released while the
 * tab is hidden and re-subscribed on return, which also refetches the current picture.
 */
export const useVisibleSubscription = (subscribe: () => () => void): void => {
  const [visible, setVisible] = useState(isDocumentVisible);

  useEffect(() => {
    const sync = () => setVisible(isDocumentVisible());
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (!visible) return;
    return subscribe();
    // The caller owns the identity of `subscribe`; re-running on every render would
    // tear down and recreate the listener continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
};
