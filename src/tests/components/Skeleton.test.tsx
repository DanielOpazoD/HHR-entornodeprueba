/**
 * Tests for Skeleton Component
 * Verifies skeleton loading components render correctly.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
    Skeleton,
    SkeletonRow,
    SkeletonTable,
    SkeletonCard,
    CensusTableSkeleton,
    HandoffSkeleton
} from '@/components/shared/Skeleton';

describe('Skeleton Components', () => {
    describe('Skeleton Base', () => {
        it('should render with default props', () => {
            const { container } = render(<Skeleton />);
            expect(container.querySelector('div')).toBeInTheDocument();
        });

        it('should apply animation class based on prop', () => {
            const { container } = render(<Skeleton animation="pulse" />);
            expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
        });

        it('should apply variant class for circular', () => {
            const { container } = render(<Skeleton variant="circular" />);
            expect(container.querySelector('.rounded-full')).toBeInTheDocument();
        });

        it('should apply custom width and height', () => {
            const { container } = render(<Skeleton width={100} height={50} />);
            const element = container.querySelector('div');
            expect(element).toHaveStyle({ width: '100px', height: '50px' });
        });

        it('should apply string width and height', () => {
            const { container } = render(<Skeleton width="50%" height="2rem" />);
            const element = container.querySelector('div');
            expect(element).toHaveStyle({ width: '50%', height: '2rem' });
        });
    });

    describe('SkeletonRow', () => {
        it('should render with default columns', () => {
            const { container } = render(
                <table><tbody><SkeletonRow /></tbody></table>
            );
            const cells = container.querySelectorAll('td');
            expect(cells.length).toBe(5); // default 5 columns
        });

        it('should render with custom column count', () => {
            const { container } = render(
                <table><tbody><SkeletonRow columns={8} /></tbody></table>
            );
            const cells = container.querySelectorAll('td');
            expect(cells.length).toBe(8);
        });
    });

    describe('SkeletonTable', () => {
        it('should render with default rows', () => {
            const { container } = render(<SkeletonTable />);
            const rows = container.querySelectorAll('tr');
            expect(rows.length).toBe(5); // default 5 rows
        });

        it('should render with custom row count', () => {
            const { container } = render(<SkeletonTable rows={10} />);
            const rows = container.querySelectorAll('tr');
            expect(rows.length).toBe(10);
        });

        it('should render header when showHeader is true', () => {
            const { container } = render(<SkeletonTable showHeader={true} />);
            expect(container.querySelector('.bg-slate-50')).toBeInTheDocument();
        });
    });

    describe('SkeletonCard', () => {
        it('should render without avatar by default', () => {
            const { container } = render(<SkeletonCard />);
            expect(container.querySelector('.rounded-full')).not.toBeInTheDocument();
        });

        it('should render with avatar when showAvatar is true', () => {
            const { container } = render(<SkeletonCard showAvatar={true} />);
            expect(container.querySelector('.rounded-full')).toBeInTheDocument();
        });

        it('should render with custom line count', () => {
            const { container } = render(<SkeletonCard lines={5} />);
            // Lines are in the space-y-2 div
            const skeleton = container.querySelector('.space-y-2');
            expect(skeleton).toBeInTheDocument();
        });
    });

    describe('CensusTableSkeleton', () => {
        it('should render census-specific skeleton', () => {
            const { container } = render(<CensusTableSkeleton />);
            expect(container.querySelector('.space-y-4')).toBeInTheDocument();
        });

        it('should render header stats section', () => {
            const { container } = render(<CensusTableSkeleton />);
            const headerSection = container.querySelector('.bg-white.rounded-lg');
            expect(headerSection).toBeInTheDocument();
        });
    });

    describe('HandoffSkeleton', () => {
        it('should render handoff-specific skeleton', () => {
            const { container } = render(<HandoffSkeleton />);
            expect(container.querySelector('.space-y-4')).toBeInTheDocument();
        });
    });
});
