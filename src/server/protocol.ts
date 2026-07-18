import type {
  ReactionTimeoutSeconds,
  RoomCapacity,
  RoomEntryResult,
  RoomSnapshot,
  StartSeatMode,
} from "../room";
import type { PlayerProjection, SpectatorProjection } from "../game/engine";
import type { GameCommand } from "./game-session";
import type { ReactionTimerSnapshot } from "./reaction-timeout";
import type { PlayerReactionEvent, PlayerReactionKind } from "../social-reactions";

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
  viewerIsSpectator: boolean;
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
  "room:spectate": (
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
  "room:bot:add": (
    request: { seatIndex: number },
    acknowledge: Acknowledge,
  ) => void;
  "room:bot:fill": (
    request: Record<string, never>,
    acknowledge: Acknowledge,
  ) => void;
  "room:bot:remove": (
    request: { targetPlayerId: string },
    acknowledge: Acknowledge,
  ) => void;
  "room:bot:takeover": (
    request: { targetPlayerId: string; enabled: boolean },
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
  "room:chat": (
    request: { text: string },
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
  "game:player-reaction": (
    request: { kind: PlayerReactionKind; targetPlayerId: string },
    acknowledge: Acknowledge<PlayerReactionEvent>,
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
  "game:spectator-snapshot": (game: SpectatorProjection) => void;
  "game:reaction-timer": (timer: ReactionTimerSnapshot | null) => void;
  "game:player-reaction": (event: PlayerReactionEvent) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
  isSpectator?: boolean;
  detached?: boolean;
}

export function projectRoomForPlayer(
  room: RoomSnapshot,
  playerId: string,
): SafeRoomSnapshot {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player })),
    spectators: room.spectators.map((spectator) => ({ ...spectator })),
    pendingSeatSwaps: room.pendingSeatSwaps
      .filter(
        (request) =>
          request.requesterId === playerId || request.recipientId === playerId,
      )
      .map((request) => ({ ...request })),
    publicAuditLog: [...room.publicAuditLog],
    chatMessages: room.chatMessages.map((message) => ({ ...message })),
    viewerPlayerId: playerId,
    viewerIsHost: room.hostPlayerId === playerId,
    viewerIsSpectator: room.spectators.some((spectator) => spectator.id === playerId),
  };
}
