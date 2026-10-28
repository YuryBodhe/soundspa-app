export function adminLocationPath(locationId: string): string {
  return `/admin/ui/locations/${encodeURIComponent(locationId)}`;
}
