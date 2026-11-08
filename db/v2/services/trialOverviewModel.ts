export type ManualTrialOverviewRecord = {
  id: string;
  organizationName: string;
  locationName: string;
  productName: string;
  trialStatus: "active" | "expired";
  startsAt: Date;
  endsAt: Date;
  invalidatedByResetId: string | null;
  organizationArchivedAt: Date | null;
  locationArchivedAt: Date | null;
};

export type ManualTrialOverviewRow = {
  id: string;
  organizationName: string;
  locationName: string;
  productName: string;
  startsAt: string;
  endsAt: string;
  status: "Active" | "Upcoming" | "Expired";
};

export function buildManualTrialOverview(rows: readonly ManualTrialOverviewRecord[], now: Date): ManualTrialOverviewRow[] {
  return rows.filter((row) => row.invalidatedByResetId === null && row.organizationArchivedAt === null && row.locationArchivedAt === null)
    .map((row) => ({
      id: row.id,
      organizationName: row.organizationName,
      locationName: row.locationName,
      productName: row.productName,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      status: row.trialStatus !== "active" || row.endsAt <= now ? "Expired" : row.startsAt > now ? "Upcoming" : "Active",
    }));
}
