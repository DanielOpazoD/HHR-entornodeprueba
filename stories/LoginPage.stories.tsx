import type { Meta, StoryObj } from '@storybook/react';
import { LoginPage } from '@/components/auth/LoginPage';

const meta: Meta<typeof LoginPage> = {
    title: 'Hospital/LoginPage',
    component: LoginPage,
    parameters: {
        layout: 'fullscreen',
    },
    tags: ['autodocs'],
    argTypes: {
        onLoginSuccess: { action: 'login success' },
    },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default login page view
 */
export const Default: Story = {
    args: {
        onLoginSuccess: () => console.log('Login successful!'),
    },
};
