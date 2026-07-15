export const SUPPORTED_ROOM_CAPACITIES = [2, 5, 6, 7, 8] as const;
export type RoomCapacity = (typeof SUPPORTED_ROOM_CAPACITIES)[number];

export const REACTION_TIMEOUT_OPTIONS = [null, 10, 15, 20, 30, 60] as const;
export type ReactionTimeoutSeconds = (typeof REACTION_TIMEOUT_OPTIONS)[number];

export type RoomPhase = "lobby" | "started";
export type StartSeatMode = "as-is" | "random";

export interface RoomPlayerSnapshot {
  id: string;
  displayName: string;
  seatIndex: number;
  isHost: boolean;
  connected: boolean;
  alive: boolean;
}

export interface SeatSwapRequestSnapshot {
  id: string;
  requesterId: string;
  recipientId: string;
  requesterSeatIndex: number;
  recipientSeatIndex: number;
}

export interface RoomSnapshot {
  code: string;
  capacity: RoomCapacity;
  mode: "duel" | "standard";
  phase: RoomPhase;
  hostPlayerId: string | null;
  players: RoomPlayerSnapshot[];
  pendingSeatSwaps: SeatSwapRequestSnapshot[];
  reactionTimeoutSeconds: ReactionTimeoutSeconds;
  gamePausedForDisconnect: boolean;
  publicAuditLog: string[];
}

export interface PlayerCredentials {
  playerId: string;
  reconnectToken: string;
}

export interface RoomEntryResult extends PlayerCredentials {
  room: RoomSnapshot;
}

export interface StartRoomResult {
  room: RoomSnapshot;
  seatOrder: string[];
  initialActivePlayerId: string;
}

export type RoomRandom = () => number;
export type RoomIdGenerator = () => string;
export type NormalDeathResolver = (playerId: string) => void;
