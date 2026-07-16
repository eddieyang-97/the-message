export const SUPPORTED_PLAYER_COUNTS = [2, 5, 6, 7, 8] as const;

export type PlayerCount = (typeof SUPPORTED_PLAYER_COUNTS)[number];

export const REACTION_TIMEOUT_OPTIONS = [0, 10, 15, 20, 30, 60] as const;

export type ReactionTimeoutSeconds =
  (typeof REACTION_TIMEOUT_OPTIONS)[number];

export type StartMode = "current-seats" | "random-seats";

export interface CreateRoomInput {
  displayName: string;
  playerCount: PlayerCount;
  roomCode?: string;
}
export interface JoinRoomInput {
  displayName: string;
  roomCode: string;
}

export type InviteEntryState =
  | { kind: "none" }
  | { kind: "loading"; roomCode: string }
  | { kind: "valid"; roomCode: string }
  | { kind: "invalid"; roomCode: string; message?: string };

export interface LobbyPlayer {
  id: string;
  displayName: string;
  seat: number;
  isHost: boolean;
  isConnected: boolean;
  isBot: boolean;
}

export interface SeatSwapRequest {
  id: string;
  fromPlayerId: string;
  fromDisplayName: string;
  fromSeat: number;
  toPlayerId: string;
  toDisplayName: string;
  toSeat: number;
}
