import React from 'react';
import { Loader2 } from 'lucide-react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonStyles';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    icon,
    iconPosition = 'left',
    className = '',
    disabled,
    ...props
  },
  ref
) {
  return (
    <button
      {...props}
      ref={ref}
      className={buttonClassName(variant, size, className)}
      disabled={isLoading || disabled}
      aria-busy={isLoading || props['aria-busy']}
    >
      {isLoading && (
        <Loader2 className="animate-spin" size={size === 'sm' ? 14 : 18} aria-hidden="true" />
      )}
      {!isLoading && icon && iconPosition === 'left' && (
        <span className="hhr-button-icon">{icon}</span>
      )}
      {children}
      {!isLoading && icon && iconPosition === 'right' && (
        <span className="hhr-button-icon">{icon}</span>
      )}
    </button>
  );
});
