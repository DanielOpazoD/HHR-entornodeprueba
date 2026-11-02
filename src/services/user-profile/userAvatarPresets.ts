export interface UserAvatarPreset {
  id: string;
  label: string;
  url: string;
}

const preset = (id: string, label: string): UserAvatarPreset => ({
  id,
  label,
  url: `/avatars/${id}.svg`,
});

export const USER_AVATAR_PRESETS: readonly UserAvatarPreset[] = [
  preset('estetoscopio', 'Estetoscopio'),
  preset('corazon', 'Corazón'),
  preset('cruz', 'Cruz'),
  preset('jeringa', 'Jeringa'),
  preset('pildora', 'Píldora'),
  preset('monitor', 'Monitor'),
  preset('flor', 'Flor'),
  preset('sol', 'Sol'),
  preset('olas', 'Olas'),
  preset('pez', 'Pez'),
  preset('ave', 'Ave'),
  preset('hoja', 'Hoja'),
];
