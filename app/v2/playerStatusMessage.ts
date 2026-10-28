import type { MonitoringConnectionState } from "./playerMonitoring";
import type { PlayerOwnershipState } from "./playerOwnership";

export type PlayerStatusMessageKey =
  | "playerOwnershipUnsupported"
  | "deviceSetupRequired"
  | "playerOwnershipActive"
  | "playerOwnershipWaiting"
  | "playerMonitoringUnavailable"
  | "playerMonitoringRecovery";

export function playerStatusMessageKey(input: {
  monitoringEnabled: boolean;
  ownershipState: PlayerOwnershipState;
  monitoringState: MonitoringConnectionState;
  monitoringPreviouslyConnected?: boolean;
}): PlayerStatusMessageKey | null {
  if (!input.monitoringEnabled) return null;
  if (input.ownershipState === "unsupported") return "playerOwnershipUnsupported";
  if (input.monitoringState === "unauthorized") return "deviceSetupRequired";
  if (input.ownershipState === "activeElsewhere") return "playerOwnershipActive";
  if (input.ownershipState !== "owned") return "playerOwnershipWaiting";
  if (input.monitoringState === "rejected") return "playerMonitoringUnavailable";
  if (input.monitoringState === "retrying" || input.monitoringState === "waiting" || input.monitoringState === "connecting") {
    return input.monitoringPreviouslyConnected ? "playerMonitoringRecovery" : null;
  }
  return null;
}
