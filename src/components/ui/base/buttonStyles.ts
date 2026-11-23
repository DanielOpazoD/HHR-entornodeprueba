export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

/** Shared visual contract for buttons and button-styled links. */
export const buttonClassName = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = ''
): string => `hhr-button hhr-button--${variant} hhr-button--${size} ${className}`.trim();
