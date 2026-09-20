export { v2Db, v2Pool } from "./client";
export { authenticateDeviceCredential } from "./queries/devices";
export type V2Db = typeof import("./client").v2Db;
