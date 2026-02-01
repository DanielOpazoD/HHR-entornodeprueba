/**
 * Skeleton Components
 * Provides loading placeholder components for better UX.
 */

import React from 'react';
import clsx from 'clsx';

// ============================================================================
// Base Skeleton
// ============================================================================

interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
    variant?: 'text' | 'circular' | 'rectangular' | 'rounded';
    animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton: React.FC<SkeletonProps> = ({
    className,
    width,
    height,
    variant = 'text',
    animation = 'pulse'
}) => {
    const variantClasses = {
        text: 'rounded',
        circular: 'rounded-full',
        rectangular: 'rounded-none',
        rounded: 'rounded-lg'
    };

    const animationClasses = {
        pulse: 'animate-pulse',
        wave: 'animate-shimmer',
        none: ''
    };

    return (
        <div
            className={clsx(
                'bg-slate-200',
                variantClasses[variant],
                animationClasses[animation],
                className
            )}
            style={{
                width: typeof width === 'number' ? `${width}px` : width,
                height: typeof height === 'number' ? `${height}px` : height || (variant === 'text' ? '1em' : undefined)
            }}
        />
    );
};

// ============================================================================
// Skeleton Row (for tables)
// ============================================================================

interface SkeletonRowProps {
    columns?: number;
    height?: number;
}

export const SkeletonRow: React.FC<SkeletonRowProps> = ({
    columns = 5,
    height = 40
}) => {
    return (
        <tr className="border-b border-slate-100">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="p-2">
                    <Skeleton
                        variant="rounded"
                        height={height - 16}
                        className={i === 0 ? 'w-16' : 'w-full'}
                    />
                </td>
            ))}
        </tr>
    );
};

// ============================================================================
// Skeleton Table
// ============================================================================

interface SkeletonTableProps {
    rows?: number;
    columns?: number;
    showHeader?: boolean;
}

export const SkeletonTable: React.FC<SkeletonTableProps> = ({
    rows = 5,
    columns = 6,
    showHeader = true
}) => {
    return (
        <div className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
            {showHeader && (
                <div className="bg-slate-50 border-b border-slate-200 p-3 flex gap-4">
                    {Array.from({ length: columns }).map((_, i) => (
                        <Skeleton
                            key={i}
                            variant="rounded"
                            height={20}
                            className={i === 0 ? 'w-20' : 'flex-1'}
                        />
                    ))}
                </div>
            )}
            <table className="w-full">
                <tbody>
                    {Array.from({ length: rows }).map((_, i) => (
                        <SkeletonRow key={i} columns={columns} />
                    ))}
                </tbody>
            </table>
        </div>
    );
};

// ============================================================================
// Skeleton Card
// ============================================================================

interface SkeletonCardProps {
    showAvatar?: boolean;
    lines?: number;
}

export const SkeletonCard: React.FC<SkeletonCardProps> = ({
    showAvatar = false,
    lines = 3
}) => {
    return (
        <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
            {showAvatar && (
                <div className="flex items-center gap-3">
                    <Skeleton variant="circular" width={40} height={40} />
                    <div className="flex-1 space-y-2">
                        <Skeleton variant="text" className="w-3/4" height={16} />
                        <Skeleton variant="text" className="w-1/2" height={12} />
                    </div>
                </div>
            )}
            <div className="space-y-2">
                {Array.from({ length: lines }).map((_, i) => (
                    <Skeleton
                        key={i}
                        variant="text"
                        height={14}
                        className={i === lines - 1 ? 'w-2/3' : 'w-full'}
                    />
                ))}
            </div>
        </div>
    );
};

// ============================================================================
// Census Table Skeleton (specific to this app)
// ============================================================================

export const CensusTableSkeleton: React.FC = () => {
    return (
        <div className="space-y-4">
            {/* Header stats skeleton */}
            <div className="flex gap-4 p-4 bg-white rounded-lg border border-slate-200">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex-1 space-y-2">
                        <Skeleton variant="text" height={12} className="w-20" />
                        <Skeleton variant="text" height={24} className="w-12" />
                    </div>
                ))}
            </div>

            {/* Table skeleton */}
            <SkeletonTable rows={10} columns={7} />
        </div>
    );
};

// ============================================================================
// Handoff Skeleton (specific to this app)
// ============================================================================

export const HandoffSkeleton: React.FC = () => {
    return (
        <div className="space-y-4 p-4">
            {/* Header */}
            <div className="flex justify-between items-center">
                <Skeleton variant="rounded" width={200} height={32} />
                <div className="flex gap-2">
                    <Skeleton variant="rounded" width={80} height={32} />
                    <Skeleton variant="rounded" width={80} height={32} />
                </div>
            </div>

            {/* Content cards */}
            {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonCard key={i} showAvatar lines={4} />
            ))}
        </div>
    );
};

// ============================================================================
// Audit Log Skeleton
// ============================================================================

export const AuditEntrySkeleton: React.FC = () => (
    <div className="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-100 mb-2">
        <Skeleton variant="circular" width={32} height={32} />
        <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2">
                <Skeleton variant="rounded" width={80} height={20} />
                <Skeleton variant="rounded" width={60} height={16} />
            </div>
            <Skeleton variant="text" height={14} className="w-full" />
            <Skeleton variant="text" height={12} className="w-24" />
        </div>
    </div>
);

export const AuditSkeleton: React.FC<{ entries?: number }> = ({ entries = 10 }) => (
    <div className="space-y-2">
        {Array.from({ length: entries }).map((_, i) => (
            <AuditEntrySkeleton key={i} />
        ))}
    </div>
);

// ============================================================================
// File List Skeleton (for BackupFilesView)
// ============================================================================

export const FileListSkeleton: React.FC<{ items?: number }> = ({ items = 6 }) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: items }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 p-4">
                <div className="flex items-center gap-3">
                    <Skeleton variant="rounded" width={40} height={40} />
                    <div className="flex-1 space-y-1">
                        <Skeleton variant="text" height={14} className="w-3/4" />
                        <Skeleton variant="text" height={10} className="w-1/2" />
                    </div>
                </div>
            </div>
        ))}
    </div>
);
