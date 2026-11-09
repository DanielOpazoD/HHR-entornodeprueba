/** The native login owns the ContextId; HSP/VHCC tokens are never substituted for it. */
(function (root) {
  'use strict';
  const { fail, positiveId, sameId } = root.HhrUrgencyApi;
  const validProfile = profile => {
    const staff = profile?.StaffMember;
    return !profile?.IsDeleted && !staff?.IsDeleted && positiveId(staff?.IdStaffMember) &&
      positiveId(staff.IdHealthCareCenter) && positiveId(profile.Id) &&
      Array.isArray(profile.Permissions) && profile.Permissions.length > 0;
  };
  const choicesFor = users => (Array.isArray(users) ? users : []).flatMap((user, index) => {
    const profile = user?.Profile, staff = profile?.StaffMember;
    if (user?.IsDeleted || !validProfile(profile)) return [];
    return (Array.isArray(user.HealthPractitionerTypes) ? user.HealthPractitionerTypes : [])
      .filter(type => positiveId(type?.Id) && !type.IsDeleted)
      .map((type, typeIndex) => ({
        id: `${index}:${typeIndex}`, professionTypeId: type.Id,
        staffId: staff.IdStaffMember, facilityId: staff.IdHealthCareCenter, profileId: profile.Id,
        label: `${String(user.HealthCareCenter || 'Establecimiento')} · ${String(type.Name || 'Profesional')}`,
      }));
  });
  const loginStage = data => {
    if (typeof data?.ContextId !== 'string' || !data.ContextId || data.ContextId.length > 4096)
      fail('ACCESS');
    if (data.RequiereActivacionMFA || data.StatusMFA === 99998) fail('MFA_SETUP');
    if (data.StatusMFA === 99999) return { state: 'otp', contextId: data.ContextId };
    if (data.StatusMFA !== 200) fail('ACCESS');
    const choices = choicesFor(data.Usuarios);
    if (!choices.length) fail('ACCESS');
    return { state: 'profiles', contextId: data.ContextId, choices };
  };
  const otpChoices = data => {
    const result = Array.isArray(data) ? data[0] : data;
    if (result?.Valido !== true) fail('OTP');
    const choices = choicesFor(result.Usuarios || result.usuarios);
    if (!choices.length) fail('ACCESS');
    return choices;
  };
  const nativeSession = (response, choice) => {
    const profile = response?.Profile, staff = profile?.StaffMember;
    if (typeof response?.EncodedToken !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(response.EncodedToken))
      fail('ACCESS');
    if (!validProfile(profile) || !sameId(profile.Id, choice.profileId) ||
        !sameId(staff?.IdStaffMember, choice.staffId) || !sameId(staff?.IdHealthCareCenter, choice.facilityId) ||
        !positiveId(choice.professionTypeId)) fail('ACCESS');
    return { token: response.EncodedToken, facilityId: String(choice.facilityId), staffId: String(choice.staffId) };
  };
  root.HhrUrgencyAuthModel = { loginStage, otpChoices, nativeSession };
})(typeof self !== 'undefined' ? self : globalThis);
