import React from 'react';

interface HospitalSpinnerProps {
  size?: number;
  className?: string;
  alt?: string;
}

/**
 * HospitalSpinner
 * Rotating loading icon based on Hospital Hanga Roa logo.
 */
export const HospitalSpinner: React.FC<HospitalSpinnerProps> = ({
  size = 56,
  className = '',
  alt = 'Cargando información',
}) => {
  return (
    <img
      src="/images/logos/logo_HHR.png"
      alt={alt}
      width={size}
      height={size}
      className={`animate-spin select-none ${className}`.trim()}
      style={{ animationDuration: '1.25s' }}
      draggable={false}
    />
  );
};
