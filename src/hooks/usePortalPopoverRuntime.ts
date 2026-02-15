import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';

interface UsePortalPopoverRuntimeOptions<TPosition> {
  isOpen: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  initialPosition: TPosition;
  resolvePosition: () => TPosition | null;
  onClose: () => void;
  closeOnOutsideClick?: boolean;
  closeOnScroll?: boolean;
  closeOnEscape?: boolean;
  repositionOnResize?: boolean;
}

interface UsePortalPopoverRuntimeResult<TPosition> {
  position: TPosition;
  updatePosition: () => void;
}

const containsTarget = (element: HTMLElement | null, target: EventTarget | null): boolean =>
  Boolean(element && target instanceof Node && element.contains(target));

export const usePortalPopoverRuntime = <TPosition>({
  isOpen,
  anchorRef,
  popoverRef,
  initialPosition,
  resolvePosition,
  onClose,
  closeOnOutsideClick = true,
  closeOnScroll = true,
  closeOnEscape = true,
  repositionOnResize = true,
}: UsePortalPopoverRuntimeOptions<TPosition>): UsePortalPopoverRuntimeResult<TPosition> => {
  const [position, setPosition] = useState<TPosition>(initialPosition);

  const updatePosition = useCallback(() => {
    const nextPosition = resolvePosition();
    if (nextPosition) {
      setPosition(nextPosition);
    }
  }, [resolvePosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePosition();

    if (!repositionOnResize) {
      return;
    }

    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen, repositionOnResize, updatePosition]);

  useEffect(() => {
    if (!isOpen || !closeOnOutsideClick) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containsTarget(popoverRef.current, event.target) ||
        containsTarget(anchorRef.current, event.target)
      ) {
        return;
      }
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [anchorRef, closeOnOutsideClick, isOpen, onClose, popoverRef]);

  useEffect(() => {
    if (!isOpen || !closeOnScroll) {
      return;
    }

    const handleScroll = (event: Event) => {
      if (containsTarget(popoverRef.current, event.target)) {
        return;
      }
      onClose();
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [closeOnScroll, isOpen, onClose, popoverRef]);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeOnEscape, isOpen, onClose]);

  return {
    position,
    updatePosition,
  };
};
