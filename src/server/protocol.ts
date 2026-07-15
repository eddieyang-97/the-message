import type {
  ReactionTimeoutSeconds,
  RoomCapacity,
  RoomEntryResult,
  RoomSnapshot,
  StartSeatMode,
} from "../room";
import type { PlayerProjection } from "../game/engine";
import type { GameCommand } from "./game-session";
import type { ReactionTimerSnapshot } from "./reaction-timeout";

export interface TransportError {
  code: string;
  message: string;
}

export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: TransportError };

export type Acknowledge<T = undefined> = (result: Ack<T>) => void;

export interface SafeRoomSnapshot extends RoomSnapshot {
  viewerPlayerId: string;
  viewerIsHost: boolean;
}

export interface SafeRoomEntryResult
  extends Omit<RoomEntryResult, "room"> {
  room: SafeRoomSnapshot;
}

export interface SafeStartRoomResult {
  room: SafeRoomSnapshot;
  seatOrder: string[];
  initialActivePlayerId: string;
}

export interface ClientToServerEvents {
  "room:create": (
    request: { capacity: RoomCapacity; displayName: string; roomCode?: string },
    acknowledge: Acknowledge<SafeRoomEntryResult>,
  ) => void;
  "room:join": (
    request: { roomCode: string; displayName: string },
    acknowledge: Acknowledge<SafeRoomEntryResult>,
  ) => void;
  "room:reconnect": (
    request: { roomCode: string; reconnectToken: string },
    acknowledge: Acknowledge<SafeRoomEntryResult>,
  ) => void;
  "room:disconnect": (
    request: Record<string, never>,
    acknowledge: Acknowledge,
  ) => void;
  "room:leave": (
    request: Record<string, never>,
    acknowledge: Acknowledge,
  ) => void;
  "room:remove": (
    request: { targetPlayerId: string },
    acknowledge: Acknowledge,
  ) => void;
  "room:move": (
    request: { seatIndex: number },
    acknowledge: Acknowledge,
  ) => void;
  "room:swap": (
    request: { targetSeatIndex: number },
    acknowledge: Acknowledge,
  ) => void;
  "room:swap:respond": (
    request: { requestId: string; accept: boolean },
    acknowledge: Acknowledge,
  ) => void;
  "room:timeout": (
    request: { seconds: ReactionTimeoutSeconds },
    acknowledge: Acknowledge,
  ) => void;
  "room:start": (
    request: { seatMode: StartSeatMode },
    acknowledge: Acknowledge<SafeStartRoomResult>,
  ) => void;
  "room:new-game": (
    request: Record<string, never>,
    acknowledge: Acknowledge,
  ) => void;
  "room:mark-dead": (
    request: { targetPlayerId: string },
    acknowledge: Acknowledge,
  ) => void;
  "game:command": (
    request: { command: GameCommand },
    acknowledge: Acknowledge<PlayerProjection>,
  ) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (room: SafeRoomSnapshot) => void;
  "room:removed": (event: {
    roomCode: string;
    reason: "left" | "removed";
  }) => void;
  "room:started": (result: SafeStartRoomResult) => void;
  "game:snapshot": (game: PlayerProjection) => void;
  "game:reaction-timer": (timer: ReactionTimerSnapshot | null) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
  detached?: boolean;
}

export function projectRoomForPlayer(
  room: RoomSnapshot,
  playerId: string,
): SafeRoomSnapshot {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player })),
    pendingSeatSwaps: room.pendingSeatSwaps
      .filter(
        (request) =>
          request.requesterId === playerId || request.recipientId === playerId,
      )
      .map((request) => ({ ...request })),
    publicAuditLog: [...room.publicAuditLog],
    viewerPlayerId: playerId,
    viewerIsHost: room.hostPlayerId === playerId,
  };
}
