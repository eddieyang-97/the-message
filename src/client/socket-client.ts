import { io, type Socket } from "socket.io-client";

import type {
  RoomEntryResult,
  RoomSnapshot,
  StartRoomResult,
  StartSeatMode,
} from "../room";
import type { PlayerProjection } from "../game/engine";
import type { GameCommand, ReactionTimerSnapshot } from "../server";

type AckSuccess<T> = { ok: true; data: T };
type AckFailure = { ok: false; error: { code?: string; message: string } };
type Ack<T> = AckSuccess<T> | AckFailure;

export class LobbyRequestError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "LobbyRequestError";
    this.code = code;
  }
}

export interface LobbySocketClient {
  createRoom(input: { capacity: number; displayName: string }): Promise<RoomEntryResult>;
  joinRoom(input: { roomCode: string; displayName: string }): Promise<RoomEntryResult>;
  reconnect(input: { roomCode: string; reconnectToken: string }): Promise<RoomEntryResult>;
  leaveRoom(): Promise<void>;
  requestSeat(input: { seatIndex: number }): Promise<void>;
  answerSeatSwap(input: { requestId: string; accept: boolean }): Promise<void>;
  removePlayer(input: { targetPlayerId: string }): Promise<void>;
  setReactionTimeout(input: { seconds: number | null }): Promise<void>;
  startRoom(input: { seatMode: StartSeatMode }): Promise<StartRoomResult>;
  onRoomUpdated(listener: (room: RoomSnapshot) => void): () => void;
  onRemoved(listener: (message?: string) => void): () => void;
  onRoomStarted(listener: (result: StartRoomResult) => void): () => void;
  onConnect(listener: () => void): () => void;
  onDisconnect(listener: () => void): () => void;
  onGameSnapshot(listener: (projection: PlayerProjection) => void): () => void;
  onReactionTimer(listener: (timer: ReactionTimerSnapshot | null) => void): () => void;
  sendGameCommand(command: GameCommand): Promise<PlayerProjection>;
  disconnect(): void;
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket.timeout(10_000).emit(event, payload, (timeoutError: Error | null, ack?: Ack<T>) => {
      if (timeoutError) {
        reject(new LobbyRequestError("服务器没有响应，请稍后重试"));
        return;
      }
      if (!ack) {
        reject(new LobbyRequestError("服务器返回了无效响应"));
        return;
      }
      if (!ack.ok) {
        reject(new LobbyRequestError(ack.error.message, ack.error.code));
        return;
      }
      resolve(ack.data);
    });
  });
}

export function createLobbySocketClient(socket: Socket = io()): LobbySocketClient {
  return {
    createRoom: (input) => emitAck(socket, "room:create", input),
    joinRoom: (input) => emitAck(socket, "room:join", input),
    reconnect: (input) => emitAck(socket, "room:reconnect", input),
    leaveRoom: () => emitAck(socket, "room:leave", {}),
    requestSeat: (input) => emitAck(socket, "room:move", input),
    answerSeatSwap: (input) => emitAck(socket, "room:swap:respond", input),
    removePlayer: (input) => emitAck(socket, "room:remove", input),
    setReactionTimeout: (input) => emitAck(socket, "room:timeout", input),
    startRoom: (input) => emitAck(socket, "room:start", input),
    onRoomUpdated(listener) {
      socket.on("room:snapshot", listener);
      return () => socket.off("room:snapshot", listener);
    },
    onRemoved(listener) {
      const handler = (payload: { reason?: "left" | "removed" }) =>
        listener(payload.reason === "removed" ? "你已被房主移出房间" : undefined);
      socket.on("room:removed", handler);
      return () => socket.off("room:removed", handler);
    },
    onRoomStarted(listener) {
      socket.on("room:started", listener);
      return () => socket.off("room:started", listener);
    },
    onConnect(listener) {
      socket.on("connect", listener);
      return () => socket.off("connect", listener);
    },
    onDisconnect(listener) {
      socket.on("disconnect", listener);
      return () => socket.off("disconnect", listener);
    },
    onGameSnapshot(listener) {
      socket.on("game:snapshot", listener);
      return () => socket.off("game:snapshot", listener);
    },
    onReactionTimer(listener) {
      socket.on("game:reaction-timer", listener);
      return () => socket.off("game:reaction-timer", listener);
    },
    sendGameCommand: (command) => emitAck(socket, "game:command", { command }),
    disconnect: () => socket.disconnect(),
  };
}
