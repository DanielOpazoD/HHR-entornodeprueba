interface ResolveBedTypeToggleVisibilityParams {
    bedId: string;
    readOnly: boolean;
    isEmpty: boolean;
}

export const shouldShowBedTypeToggle = ({
    bedId,
    readOnly,
    isEmpty
}: ResolveBedTypeToggleVisibilityParams): boolean =>
    !readOnly && !isEmpty && bedId.startsWith('R');
