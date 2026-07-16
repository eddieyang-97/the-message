export { RoomError, type RoomErrorCode } from "./errors";
export {
  RoomService,
  buildRoomInviteUrl,
  isRoomCapacity,
  normalizeRoomCode,
  type RoomServiceOptions,
} from "./room-service";
export {
  REACTION_TIMEOUT_OPTIONS,
  SUPPORTED_ROOM_CAPACITIES,
  type PlayerCredentials,
  type NormalDeathResolver,
  type ReactionTimeoutSeconds,
  type RoomCapacity,
  type RoomEntryResult,
  type RoomPhase,
  type RoomPlayerSnapshot,
  type RoomRandom,
  type RoomSnapshot,
  type PublicAuditEvent,
  type SeatSwapRequestSnapshot,
  type StartRoomResult,
  type StartSeatMode,
} from "./types";
