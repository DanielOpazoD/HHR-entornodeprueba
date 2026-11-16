export interface HandoffManagementActions {
  updateHandoffChecklist: (
    shift: 'day' | 'night' | 'shared',
    field: string,
    value: boolean | string
  ) => void;
  updateHandoffNovedades: (shift: 'day' | 'night', value: string) => void;
  updateHandoffStaff: (
    shift: 'day' | 'night',
    type: 'delivers' | 'receives' | 'tens',
    staffList: string[]
  ) => void;
}
