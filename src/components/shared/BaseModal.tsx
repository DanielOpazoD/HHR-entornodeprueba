/**
 * BaseModal Component
 *
 * A reusable modal wrapper that provides consistent styling and behavior
 * across all modals in the application. Includes:
 * - Semi-transparent backdrop with blur effect
 * - Glass morphism container with animations
 * - Consistent header with title and close button
 * - Scrollable content area
 *
 * @example
 * ```tsx
 * <BaseModal
 *     isOpen={showSettings}
 *     onClose={() => setShowSettings(false)}
 *     title="Configuración"
 *     icon={<Settings size={18} />}
 * >
 *     <ModalContent />
 * </BaseModal>
 * ```
 */

import type React from 'react';
import type { BaseModalProps } from '@/components/shared/baseModalContracts';
import { BaseModalContent } from '@/components/shared/baseModalContent';
export { ModalSection, type ModalSectionProps } from '@/components/shared/baseModalSection';
export type { BaseModalProps } from '@/components/shared/baseModalContracts';

/**
 * BaseModal Component
 *
 * Provides a consistent modal layout with header, body, and styling.
 * Uses an opaque light surface by default so clinical information keeps stable contrast over the
 * modal backdrop. Glass remains available as an explicit variant for decorative surfaces.
 */
export const BaseModal: React.FC<BaseModalProps> = props => <BaseModalContent {...props} />;

export default BaseModal;
