import { relations } from "drizzle-orm";
import { channels } from "../product/channels";
import { locations } from "../core/locations";
import { devices } from "./devices";
import { deviceCurrentState } from "./deviceCurrentState";
import { deviceEvents } from "./deviceEvents";

export const deviceCurrentStateRelations = relations(deviceCurrentState, ({ one }) => ({
  device: one(devices, { fields: [deviceCurrentState.deviceId], references: [devices.id] }),
  currentChannel: one(channels, { fields: [deviceCurrentState.currentChannelId], references: [channels.id] }),
}));
export const deviceRelations = relations(devices, ({ one, many }) => ({
  location: one(locations, { fields: [devices.locationId], references: [locations.id] }),
  currentState: one(deviceCurrentState, { fields: [devices.id], references: [deviceCurrentState.deviceId] }),
  events: many(deviceEvents),
}));
export const deviceEventRelations = relations(deviceEvents, ({ one }) => ({
  device: one(devices, { fields: [deviceEvents.deviceId], references: [devices.id] }),
  channel: one(channels, { fields: [deviceEvents.channelId], references: [channels.id] }),
}));
