/** Location fields aligned with `locations` / submission payload; `state` holds zone name. */
export interface LocationData {
  state: string;
  district: string;
  assembly: string;
  halka: string;
  village: string;
  booth_number: string;
}

export type UserProfileFields = {
  preferred_assembly?: string | null;
  profile_data?: Record<string, unknown> | null;
};

export function getZoneDistrictAssembly(user: UserProfileFields | null) {
  const pd = user?.profile_data ?? {};
  return {
    zone: String(pd.Zone ?? pd.zone ?? '—').trim() || '—',
    district: String(pd.District ?? pd.district ?? '—').trim() || '—',
    assembly: String(user?.preferred_assembly ?? '—').trim() || '—',
  };
}

/** Block Coordinator / President: server uses `assembly_block` — own submissions only; assembly report is AC-wide. */
export function isBlockLevelUser(user: UserProfileFields | null): boolean {
  if (!user?.profile_data) return false;
  const pd = user.profile_data;
  const d = String(pd.Designation ?? pd.designation ?? '')
    .trim()
    .toLowerCase();
  if (!d.includes('block')) return false;
  return d.includes('coordinator') || d.includes('co-ordinator') || d.includes('president');
}

/** Fixed location from logged-in user profile (no manual location picker). Requires AC (`preferred_assembly`). */
export function buildLocationFromUser(user: UserProfileFields | null): LocationData | null {
  if (!user) return null;
  const pd = user.profile_data ?? {};
  const assembly = String(user.preferred_assembly ?? '').trim();
  if (!assembly) return null;

  const zone = String(pd.Zone ?? pd.zone ?? '').trim();
  const district = String(pd.District ?? pd.district ?? '').trim();
  const halka = String(pd.Halka ?? pd.halka ?? pd.Block ?? pd.block ?? '').trim() || '—';
  const village = String(pd.Village ?? pd.village ?? '').trim() || '—';
  const booth = String(pd.booth_number ?? pd.Booth ?? '').trim();

  return {
    state: zone || '—',
    district: district || '—',
    assembly,
    halka,
    village,
    booth_number: booth,
  };
}
