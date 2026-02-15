interface ResolveSubRowDemographicsButtonVisibilityParams {
  readOnly: boolean;
}

export const shouldShowSubRowDemographicsButton = ({
  readOnly,
}: ResolveSubRowDemographicsButtonVisibilityParams): boolean => !readOnly;
