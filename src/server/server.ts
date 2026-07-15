import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { resolve } from "node:path";

import express, { type Express } from "express";
import { Server } from "socket.io";

import { RoomError, RoomService, type StartRoomResult } from "../room";
import { GameSessionError, GameSessionService } from "./game-session";
import {
  ReactionTimeoutScheduler,
  type ReactionTimerClock,
  type ReactionTimerSnapshot,
} from "./reaction-timeout";
import {
  projectRoomForPlayer,
  type Ack,
  type Acknowledge,
  type ClientToServerEvents,
  type InterServerEvents,
  type SafeRoomEntryResult,
  type SafeStartRoomResult,
  type ServerToClientEvents,
  type SocketData,
} from "./protocol";

type FengshengSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface GameServerHooks {
  onRoomStarted?: (result: StartRoomResult) => void | Promise<void>;
}

export interface CreateGameServerOptions {
  app?: Express;
  httpServer?: HttpServer;
  roomService?: RoomService;
  staticDirectory?: string;
  corsOrigin?: string | string[];
  hooks?: GameServerHooks;
  gameSessionService?: GameSessionService;
  gameSeedGenerator?: () => number;
  reactionTimerClock?: ReactionTimerClock;
}

export interface GameServer {
  app: Express;
  httpServer: HttpServer;
  io: FengshengSocketServer;
  roomService: RoomService;
  gameSessionService: GameSessionService;
  reactionTimeoutScheduler: ReactionTimeoutScheduler;
  listen(port: number, hostname?: string): Promise<void>;
  close(): Promise<void>;
}

export function createGameServer(options: CreateGameServerOptions = {}): GameServer {
  const app = options.app ?? express();
  const httpServer = options.httpServer ?? createHttpServer(app);
  const roomService = options.roomService ?? new RoomService();
  const gameSessionService = options.gameSessionService ?? new GameSessionService();
  const gameSeedGenerator =
    options.gameSeedGenerator ?? (() => Math.floor(Math.random() * 0x1_0000_0000));
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: options.corsOrigin
      ? { origin: options.corsOrigin, credentials: true }
      : undefined,
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  if (options.staticDirectory) {
    const staticDirectory = resolve(options.staticDirectory);
    app.use(express.static(staticDirectory));
    app.get(/^(?!\/api(?:\/|$)|\/socket\.io(?:\/|$)).*/, (request, response) => {
      if (!request.accepts("html")) {
        response.sendStatus(404);
        return;
      }
      response.sendFile(resolve(staticDirectory, "index.html"));
    });
  }

  const playerSockets = new Map<string, string>();

  async function broadcastRoom(roomCode: string): Promise<void> {
    if (!roomService.hasRoom(roomCode)) return;
    const room = roomService.getRoom(roomCode);
    const sockets = await io.in(roomCode).fetchSockets();
    for (const socket of sockets) {
      const playerId = socket.data.playerId;
      if (playerId) socket.emit("room:snapshot", projectRoomForPlayer(room, playerId));
    }
  }

  async function broadcastGame(roomCode: string): Promise<void> {
    if (!gameSessionService.has(roomCode)) return;
    const sockets = await io.in(roomCode).fetchSockets();
    for (const roomSocket of sockets) {
      const playerId = roomSocket.data.playerId;
      if (playerId) {
        roomSocket.emit("game:snapshot", gameSessionService.project(roomCode, playerId));
      }
    }
  }

  function synchronizeRoomDeaths(roomCode: string): void {
    const game = gameSessionService.getState(roomCode);
    roomService.synchronizePlayerDeaths(
      roomCode,
      game.seatOrder.filter((playerId) => !game.players[playerId].alive),
    );
  }

  async function broadcastReactionTimer(
    roomCode: string,
    timer: ReactionTimerSnapshot | null,
  ): Promise<void> {
    const sockets = await io.in(roomCode).fetchSockets();
    for (const roomSocket of sockets) {
      roomSocket.emit("game:reaction-timer", timer);
    }
  }

  const reactionTimeoutScheduler = new ReactionTimeoutScheduler({
    gameSessions: gameSessionService,
    timeoutForNextPrompt: (roomCode) =>
      roomService.reactionTimeoutForNextPrompt(roomCode),
    isPaused: (roomCode) => roomService.getRoom(roomCode).gamePausedForDisconnect,
    dispatch: (roomCode, actorId, command) => {
      roomService.assertGameplayCanProgress(roomCode);
      gameSessionService.dispatch(roomCode, actorId, command);
      synchronizeRoomDeaths(roomCode);
    },
    onGameAdvanced: async (roomCode) => {
      await broadcastRoom(roomCode);
      await broadcastGame(roomCode);
    },
    onTimerChanged: broadcastReactionTimer,
    clock: options.reactionTimerClock,
  });

  io.on("connection", (socket) => {
    const reply = <T>(acknowledge: Acknowledge, action: () => T): T | undefined => {
      try {
        const data = action();
        acknowledge({ ok: true, data: undefined });
        return data;
      } catch (error) {
        acknowledge(failure(error));
        return undefined;
      }
    };

    const requireIdentity = (): { roomCode: string; playerId: string } => {
      const { roomCode, playerId } = socket.data;
      if (!roomCode || !playerId) {
        throw new TransportFailure("NOT_IN_ROOM", "当前连接尚未加入房间");
      }
      return { roomCode, playerId };
    };

    const requireUnbound = (): void => {
      if (socket.data.roomCode || socket.data.playerId) {
        throw new TransportFailure("ALREADY_IN_ROOM", "当前连接已经加入房间");
      }
    };

    const bindIdentity = async (
      roomCode: string,
      playerId: string,
    ): Promise<void> => {
      const previousSocketId = playerSockets.get(playerId);
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.data.detached = false;
      playerSockets.set(playerId, socket.id);
      if (previousSocketId && previousSocketId !== socket.id) {
        const previousSocket = io.sockets.sockets.get(previousSocketId);
        if (previousSocket) {
          previousSocket.data.detached = true;
          previousSocket.disconnect(true);
        }
      }
      await socket.join(roomCode);
    };

    const detachIdentity = async (): Promise<void> => {
      const { roomCode, playerId } = socket.data;
      if (playerId && playerSockets.get(playerId) === socket.id) {
        playerSockets.delete(playerId);
      }
      socket.data.detached = true;
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      if (roomCode) await socket.leave(roomCode);
    };

    socket.on("room:create", async (request, acknowledge) => {
      let entry: ReturnType<RoomService["createRoom"]>;
      try {
        requireUnbound();
        entry = roomService.createRoom(
          request.capacity,
          request.displayName,
          request.roomCode,
        );
        await bindIdentity(entry.room.code, entry.playerId);
        const safeEntry: SafeRoomEntryResult = {
          playerId: entry.playerId,
          reconnectToken: entry.reconnectToken,
          room: projectRoomForPlayer(entry.room, entry.playerId),
        };
        acknowledge({ ok: true, data: safeEntry });
        await broadcastRoom(entry.room.code);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:join", async (request, acknowledge) => {
      try {
        requireUnbound();
        const entry = roomService.joinRoom(request.roomCode, request.displayName);
        await bindIdentity(entry.room.code, entry.playerId);
        acknowledge({
          ok: true,
          data: {
            playerId: entry.playerId,
            reconnectToken: entry.reconnectToken,
            room: projectRoomForPlayer(entry.room, entry.playerId),
          },
        });
        await broadcastRoom(entry.room.code);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:reconnect", async (request, acknowledge) => {
      try {
        requireUnbound();
        const entry = roomService.reconnect(request.roomCode, request.reconnectToken);
        await bindIdentity(entry.room.code, entry.playerId);
        acknowledge({
          ok: true,
          data: {
            playerId: entry.playerId,
            reconnectToken: entry.reconnectToken,
            room: projectRoomForPlayer(entry.room, entry.playerId),
          },
        });
        await broadcastRoom(entry.room.code);
        if (gameSessionService.has(entry.room.code)) {
          reactionTimeoutScheduler.reconcile(entry.room.code);
          socket.emit(
            "game:snapshot",
            gameSessionService.project(entry.room.code, entry.playerId),
          );
          socket.emit(
            "game:reaction-timer",
            reactionTimeoutScheduler.snapshot(entry.room.code),
          );
        }
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:disconnect", async (_request, acknowledge) => {
      try {
        const identity = requireIdentity();
        const room = roomService.disconnect(identity.roomCode, identity.playerId);
        await detachIdentity();
        acknowledge({ ok: true, data: undefined });
        await broadcastRoom(room.code);
        reactionTimeoutScheduler.reconcile(room.code);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:leave", async (_request, acknowledge) => {
      try {
        const identity = requireIdentity();
        const room = roomService.leaveLobby(identity.roomCode, identity.playerId);
        socket.emit("room:removed", { roomCode: identity.roomCode, reason: "left" });
        await detachIdentity();
        acknowledge({ ok: true, data: undefined });
        if (room) await broadcastRoom(room.code);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:remove", async (request, acknowledge) => {
      const result = reply(acknowledge, () => {
        const identity = requireIdentity();
        const room = roomService.removeLobbyPlayer(
          identity.roomCode,
          identity.playerId,
          request.targetPlayerId,
        );
        return { identity, room };
      });
      if (!result) return;
      const targetSocketId = playerSockets.get(request.targetPlayerId);
      const targetSocket = targetSocketId ? io.sockets.sockets.get(targetSocketId) : undefined;
      if (targetSocket) {
        targetSocket.emit("room:removed", {
          roomCode: result.identity.roomCode,
          reason: "removed",
        });
        targetSocket.data.detached = true;
        targetSocket.data.roomCode = undefined;
        targetSocket.data.playerId = undefined;
        await targetSocket.leave(result.identity.roomCode);
      }
      playerSockets.delete(request.targetPlayerId);
      if (result.room) await broadcastRoom(result.room.code);
    });

    socket.on("room:move", async (request, acknowledge) => {
      const room = reply(acknowledge, () => {
        const identity = requireIdentity();
        return roomService.requestSeat(identity.roomCode, identity.playerId, request.seatIndex);
      });
      if (room) await broadcastRoom(room.code);
    });

    socket.on("room:swap", async (request, acknowledge) => {
      const room = reply(acknowledge, () => {
        const identity = requireIdentity();
        return roomService.requestSeat(
          identity.roomCode,
          identity.playerId,
          request.targetSeatIndex,
        );
      });
      if (room) await broadcastRoom(room.code);
    });

    socket.on("room:swap:respond", async (request, acknowledge) => {
      const room = reply(acknowledge, () => {
        const identity = requireIdentity();
        return roomService.answerSeatSwap(
          identity.roomCode,
          identity.playerId,
          request.requestId,
          request.accept,
        );
      });
      if (room) await broadcastRoom(room.code);
    });

    socket.on("room:timeout", async (request, acknowledge) => {
      const room = reply(acknowledge, () => {
        const identity = requireIdentity();
        return roomService.setReactionTimeout(
          identity.roomCode,
          identity.playerId,
          request.seconds,
        );
      });
      if (room) {
        await broadcastRoom(room.code);
        reactionTimeoutScheduler.reconcile(room.code);
      }
    });

    socket.on("room:start", async (request, acknowledge) => {
      try {
        const identity = requireIdentity();
        const result = roomService.startRoom(
          identity.roomCode,
          identity.playerId,
          request.seatMode,
        );
        const game = gameSessionService.create(
          result.room.code,
          result.seatOrder,
          gameSeedGenerator(),
        );
        await options.hooks?.onRoomStarted?.(result);
        const sockets = await io.in(result.room.code).fetchSockets();
        let requesterResult: SafeStartRoomResult | undefined;
        for (const roomSocket of sockets) {
          const playerId = roomSocket.data.playerId;
          if (!playerId) continue;
          const safeResult: SafeStartRoomResult = {
            room: projectRoomForPlayer(result.room, playerId),
            seatOrder: [...result.seatOrder],
            initialActivePlayerId: game.activePlayerId,
          };
          roomSocket.emit("room:started", safeResult);
          if (roomSocket.id === socket.id) requesterResult = safeResult;
        }
        acknowledge({
          ok: true,
          data:
            requesterResult ?? {
              room: projectRoomForPlayer(result.room, identity.playerId),
              seatOrder: [...result.seatOrder],
              initialActivePlayerId: game.activePlayerId,
            },
        });
        await broadcastGame(result.room.code);
        reactionTimeoutScheduler.reconcile(result.room.code);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:new-game", async (_request, acknowledge) => {
      try {
        const identity = requireIdentity();
        const game = gameSessionService.getState(identity.roomCode);
        if (game.phase !== "gameOver") {
          throw new TransportFailure("GAME_NOT_OVER", "游戏结束后才能开始新游戏");
        }
        const room = roomService.returnToLobby(
          identity.roomCode,
          identity.playerId,
        );
        gameSessionService.delete(identity.roomCode);
        reactionTimeoutScheduler.cancel(identity.roomCode);
        acknowledge({ ok: true, data: undefined });
        await broadcastRoom(room.code);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("room:mark-dead", async (request, acknowledge) => {
      const room = reply(acknowledge, () => {
        const identity = requireIdentity();
        return roomService.markDisconnectedPlayerDead(
          identity.roomCode,
          identity.playerId,
          request.targetPlayerId,
          (playerId) => {
            gameSessionService.resolveHostImposedDeath(identity.roomCode, playerId);
          },
        );
      });
      if (room) {
        await broadcastRoom(room.code);
        await broadcastGame(room.code);
        reactionTimeoutScheduler.reconcile(room.code);
      }
    });

    socket.on("game:command", async (request, acknowledge) => {
      try {
        const identity = requireIdentity();
        roomService.assertGameplayCanProgress(identity.roomCode);
        const projection = gameSessionService.dispatch(
          identity.roomCode,
          identity.playerId,
          request.command,
        );
        synchronizeRoomDeaths(identity.roomCode);
        acknowledge({ ok: true, data: projection });
        await broadcastRoom(identity.roomCode);
        await broadcastGame(identity.roomCode);
        reactionTimeoutScheduler.reconcile(identity.roomCode);
      } catch (error) {
        acknowledge(failure(error));
      }
    });

    socket.on("disconnect", () => {
      const { roomCode, playerId, detached } = socket.data;
      if (detached || !roomCode || !playerId) return;
      if (playerSockets.get(playerId) !== socket.id) return;
      playerSockets.delete(playerId);
      try {
        roomService.disconnect(roomCode, playerId);
        void broadcastRoom(roomCode);
        reactionTimeoutScheduler.reconcile(roomCode);
      } catch {
        // The room or player may already have been removed by a concurrent command.
      }
    });
  });

  return {
    app,
    httpServer,
    io,
    roomService,
    gameSessionService,
    reactionTimeoutScheduler,
    listen: (port, hostname) =>
      new Promise((resolveListen, reject) => {
        const onError = (error: Error): void => reject(error);
        httpServer.once("error", onError);
        httpServer.listen(port, hostname, () => {
          httpServer.off("error", onError);
          resolveListen();
        });
      }),
    close: () =>
      new Promise((resolveClose, reject) => {
        reactionTimeoutScheduler.close();
        io.close((error) => {
          if (error) reject(error);
          else resolveClose();
        });
      }),
  };
}

class TransportFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function failure(error: unknown): Ack<never> {
  if (
    error instanceof RoomError ||
    error instanceof TransportFailure ||
    error instanceof GameSessionError
  ) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "服务器处理请求时发生错误",
    },
  };
}
