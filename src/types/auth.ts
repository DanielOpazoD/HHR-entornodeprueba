/**
 * Authentication Types
 * Centralized type definitions for user authentication and authorization.
 */

/**
 * Available user roles in the application.
 * Controls access to different modules and features.
 */
export type UserRole =
    | 'viewer'
    | 'editor'
    | 'admin'
    | 'nurse_hospital'
    | 'doctor_urgency'
    | 'viewer_census';

/**
 * User information structure used within the application's authentication state.
 */
export interface AuthUser {
    /** Unique Firebase User ID */
    uid: string;
    /** User's email address */
    email: string | null;
    /** User's display name (usually from Google) */
    displayName: string | null;
    /** URL to user's profile picture */
    photoURL?: string | null;
    /** User's role assigned via whitelist (admin, nurse, etc.) */
    role?: UserRole;
}
