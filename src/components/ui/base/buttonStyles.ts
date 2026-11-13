export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon';

/** The same visual contract for buttons, links and legacy MedicalButton callers. */
export const buttonClassName = (
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = ''
): string => `hhr-button hhr-button--${variant} hhr-button--${size} ${className}`.trim();
