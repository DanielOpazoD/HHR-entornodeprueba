import '@/index.css';
import type { Meta, StoryObj } from '@storybook/react';
import { AuthContext } from '@/context/AuthContext';
import { UIProvider } from '@/context/UIContext';
import { ConflictVersionsAdminControl } from '@/features/census/components/ConflictVersionsAdminControl';
import type {
  ConflictVersionSnapshot,
  DailyRecordConflictRecoveryPort,
} from '@/application/ports/dailyRecordConflictRecoveryPort';

const snapshot = (
  id: string,
  origin: ConflictVersionSnapshot['origin'],
  time: string,
  patients: string[]
): ConflictVersionSnapshot => ({
  id,
  origin,
  conflictId: 'demo-conflict',
  sourceLastUpdated: `2026-06-26T${time}:00.000Z`,
  record: {
    date: '2026-06-26',
    beds: Object.fromEntries(
      patients.map((name, index) => [`R${index + 1}`, { patientName: name }])
    ),
  } as never,
});

const mockPort: DailyRecordConflictRecoveryPort = {
  listConflictVersionSnapshots: async () => [
    snapshot('s-remote', 'remote_premerge', '12:05', ['Ana Pérez', 'Luis Rojas', 'María Soto']),
    snapshot('s-incoming', 'incoming_premerge', '12:03', ['Ana Pérez', 'Luis Rojas']),
  ],
  restoreDailyRecordVersion: async () => ({ status: 'restored' }),
};

const adminAuth = { role: 'admin' } as never;

const meta: Meta<typeof ConflictVersionsAdminControl> = {
  title: 'Census/ConflictVersionsAdminControl',
  component: ConflictVersionsAdminControl,
  decorators: [
    Story => (
      <AuthContext.Provider value={adminAuth}>
        <UIProvider>
          <div className="flex min-h-[420px] items-start justify-end rounded-xl bg-slate-50 p-8">
            <Story />
          </div>
        </UIProvider>
      </AuthContext.Provider>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const SubtleButton: Story = {
  args: { date: '2026-06-26', port: mockPort },
};
