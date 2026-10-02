import { relations } from "drizzle-orm";
import { channels } from "../product/channels";
import { locations } from "../core/locations";
import { devices } from "./devices";
import { deviceActivationTokens } from "./deviceActivationTokens";
import { deviceCurrentState } from "./deviceCurrentState";
import { deviceEvents } from "./deviceEvents";

export const deviceCurrentStateRelations = relations(deviceCurrentState, ({ one }) => ({
  device: one(devices, { fields: [deviceCurrentState.deviceId], references: [devices.id] }),
  musicCurrentChannel: one(channels, { fields: [deviceCurrentState.musicCurrentChannelId], references: [channels.id] }),
  ambientCurrentChannel: one(channels, { fields: [deviceCurrentState.ambientCurrentChannelId], references: [channels.id] }),
}));
export const deviceRelations = relations(devices, ({ one, many }) => ({
  location: one(locations, { fields: [devices.locationId], references: [locations.id] }),
  currentState: one(deviceCurrentState, { fields: [devices.id], references: [deviceCurrentState.deviceId] }),
  events: many(deviceEvents),
  activationTokens: many(deviceActivationTokens),
}));
export const deviceActivationTokenRelations = relations(deviceActivationTokens, ({ one }) => ({
  device: one(devices, { fields: [deviceActivationTokens.deviceId], references: [devices.id] }),
}));
export const deviceEventRelations = relations(deviceEvents, ({ one }) => ({
  device: one(devices, { fields: [deviceEvents.deviceId], references: [devices.id] }),
  channel: one(channels, { fields: [deviceEvents.channelId], references: [channels.id] }),
}));
