import React, { useEffect, useRef, useState } from 'react';

/** Keep the page's sticky header when the table fits; preserve horizontal access on narrow screens. */
export const CensusTableViewport: React.FC<React.PropsWithChildren> = ({ children }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    const table = viewport?.querySelector('table');
    if (!viewport || !table) return;
    const measure = () => {
      if (viewport.clientWidth > 0) {
        setOverflows(table.getBoundingClientRect().width > viewport.clientWidth + 1);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(table);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={viewportRef}
      className="census-table-scroll"
      data-horizontal-overflow={overflows}
      role="region"
      aria-label="Censo de pacientes, tabla desplazable"
      tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !overflows) return;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.scrollBy({ left: event.key === 'ArrowRight' ? 240 : -240 });
      }}
    >
      {children}
    </div>
  );
};
