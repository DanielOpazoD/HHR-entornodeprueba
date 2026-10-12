import React, { useState } from 'react';
import { MoaIcon } from './MoaIcon';

/** Decorative only; the surrounding control supplies its accessible name. */
export const MoaMascot = ({ className }: { className: string }) => {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) return <MoaIcon className={className} />;

  return (
    <span className={`hhr-moa ${className}`} aria-hidden="true">
      <span className="hhr-moa-window">
        <img
          src="/images/moa/moa-wave-v2.png"
          alt=""
          className="moa-rest-frames"
          width={1728}
          height={168}
          decoding="async"
          draggable={false}
          onError={() => setUnavailable(true)}
          data-testid="moa-mascot"
        />
      </span>
    </span>
  );
};
