import { useEffect } from 'react';
import type { RefObject } from 'react';

interface UseDateStripWheelNavigationInput {
  containerRef: RefObject<HTMLDivElement | null>;
  navigateDays: (delta: number) => void;
}

export const useDateStripWheelNavigation = ({
  containerRef,
  navigateDays,
}: UseDateStripWheelNavigationInput): void => {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      // Preserve native horizontal trackpad scrolling through the visible days.
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();

      if (event.deltaY > 0) {
        navigateDays(1);
      } else if (event.deltaY < 0) {
        navigateDays(-1);
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleNativeWheel);
    };
  }, [containerRef, navigateDays]);
};
