import React from 'react';

/** Chest radiograph (film, spine and ribs) for every MMRAD imaging entry point. */
export const XRayIcon: React.FC<{ size?: number; className?: string }> = ({
  size = 24,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M12 6v12M7 9c2-1 3.5-.6 5 .6 1.5-1.2 3-1.6 5-.6M7 13c2-1 3.5-.6 5 .6 1.5-1.2 3-1.6 5-.6M8 17c1.5-.6 2.8-.3 4 .6 1.2-.9 2.5-1.2 4-.6" />
  </svg>
);
