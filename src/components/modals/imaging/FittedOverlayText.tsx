import React, { useLayoutEffect, useRef } from 'react';
import { fitFontSizePx } from '../controllers/imagingViewerController';

interface FittedOverlayTextProps {
  text: string;
  className: string;
  style: React.CSSProperties;
  width: string;
}

/** One line inside its field: the font shrinks instead of wrapping, clipping or overlapping. */
export const FittedOverlayText: React.FC<FittedOverlayTextProps> = ({
  text,
  className,
  style,
  width,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const fit = () => {
      element.style.fontSize = '';
      const baseSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
      if (!Number.isFinite(baseSize)) return;
      const size = fitFontSizePx(baseSize, element.clientWidth, element.scrollWidth);
      if (size < baseSize) element.style.fontSize = `${size}px`;
    };

    fit();
    // The page scales with the panel, and the base size changes at the `sm` breakpoint.
    if (typeof ResizeObserver === 'undefined' || !element.parentElement) return undefined;
    const observer = new ResizeObserver(fit);
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div ref={ref} className={`${className} whitespace-nowrap`} style={{ ...style, width }}>
      {text}
    </div>
  );
};
