import React, { useState } from 'react';
import { CircleHelp } from 'lucide-react';

/** Decorative only; the surrounding control supplies its accessible name. */
export const MoaMascot = ({ className }: { className: string }) => {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) return <CircleHelp className={className} aria-hidden="true" />;

  return (
    <span className={`hhr-moa ${className}`} aria-hidden="true">
      <span className="hhr-moa-window">
        <img
          src="/images/moa/moa-poses-v1.webp"
          alt=""
          className="moa-frames"
          width={816}
          height={152}
          decoding="async"
          draggable={false}
          onError={() => setUnavailable(true)}
          data-testid="moa-mascot"
        />
      </span>
    </span>
  );
};
