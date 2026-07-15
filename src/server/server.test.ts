import type { AddressInfo } from "node:net";

import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  PHYSICAL_DECK,
  type PhysicalCard,
  type PhysicalCardId,
} from "../game/cards";
import type { GameState } from "../game/engine";
import type { GameCommand } from "./game-session";

import type {
  Ack,
  ClientToServerEvents,
  SafeRoomEntryResult,
  SafeStartRoomResult,
  ServerToClientEvents,
} from "./protocol";
import { createGameServer, type GameServer } from "./server";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe("game server sessions", () => {
  let server: GameServer | undefined;
  const sockets: TestSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.disconnect();
    sockets.length = 0;
    await server?.close();
    server = undefined;
  });

  it("starts an authoritative game and emits only viewer projections", async () => {
    server = createGameServer({ gameSeedGenerator: () => 42 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([connected(host), connected(guest)]);

    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "朋友",
    });
    const hostGame = onceEvent(host, "game:snapshot");
    const guestGame = onceEvent(guest, "game:snapshot");

    const started = await emitAck<SafeStartRoomResult>(host, "room:start", {
      seatMode: "as-is",
    });
    const [hostProjection, guestProjection] = await Promise.all([hostGame, guestGame]);

    expect(started.initialActivePlayerId).toBe(hostProjection.activePlayerId);
    expect(hostProjection.own.id).toBe(created.playerId);
    expect(guestProjection.own.id).toBe(joined.playerId);
    expect(
      hostProjection.players.find((player) => player.id === joined.playerId)?.hand,
    ).toBeUndefined();
    expect(
      guestProjection.players.find((player) => player.id === created.playerId)?.hand,
    ).toBeUndefined();

    guest.disconnect();
    await eventually(() => server!.roomService.getRoom(created.room.code).gamePausedForDisconnect);
    const paused = await emitRawAck(host, "game:command", {
      command: { type: "PASS_LOCK" },
    });
    expect(paused).toMatchObject({ ok: false, error: { code: "GAME_PAUSED" } });
  });

  it("pushes the private game projection again on reconnect", async () => {
    server = createGameServer({ gameSeedGenerator: () => 7 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([connected(host), connected(guest)]);
    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "朋友",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });
    guest.disconnect();
    await eventually(() => server!.roomService.getRoom(created.room.code).gamePausedForDisconnect);

    const reconnected = connect(port);
    sockets.push(reconnected);
    await connected(reconnected);
    const projectionPromise = onceEvent(reconnected, "game:snapshot");
    await emitAck<SafeRoomEntryResult>(reconnected, "room:reconnect", {
      roomCode: created.room.code,
      reconnectToken: joined.reconnectToken,
    });
    const projection = await projectionPromise;
    expect(projection.own.id).toBe(joined.playerId);
    expect(projection.own.hand.length).toBeGreaterThanOrEqual(2);
  });

  it("authorizes host-imposed death and keeps room and game state synchronized", async () => {
    server = createGameServer({ gameSeedGenerator: () => 7 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([connected(host), connected(guest)]);
    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "朋友",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });

    expect(
      await emitRawAck(guest, "room:mark-dead", {
        targetPlayerId: created.playerId,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_HOST" } });
    expect(
      await emitRawAck(host, "room:mark-dead", {
        targetPlayerId: joined.playerId,
      }),
    ).toMatchObject({ ok: false, error: { code: "PLAYER_STILL_CONNECTED" } });

    guest.disconnect();
    await eventually(
      () => server!.roomService.getRoom(created.room.code).gamePausedForDisconnect,
    );
    const roomSnapshot = onceEvent(host, "room:snapshot");
    const gameSnapshot = onceEvent(host, "game:snapshot");
    await emitAck(host, "room:mark-dead", { targetPlayerId: joined.playerId });
    const [room, game] = await Promise.all([roomSnapshot, gameSnapshot]);

    expect(room.gamePausedForDisconnect).toBe(false);
    expect(room.players.find((player) => player.id === joined.playerId)).toMatchObject({
      alive: false,
      connected: false,
    });
    expect(game.players.find((player) => player.id === joined.playerId)).toMatchObject({
      alive: false,
      faction: expect.any(String),
    });
    expect(server.gameSessionService.getState(created.room.code).players[joined.playerId])
      .toMatchObject({ alive: false, factionRevealed: true });
    expect(server.reactionTimeoutScheduler.snapshot(created.room.code)).toBeNull();
    expect(
      await emitRawAck(host, "room:mark-dead", {
        targetPlayerId: joined.playerId,
      }),
    ).toMatchObject({ ok: false, error: { code: "PLAYER_ALREADY_DEAD" } });
  });

  it("transfers in-game host authority and does not restore it on reconnect", async () => {
    server = createGameServer({ gameSeedGenerator: () => 11 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([connected(host), connected(guest)]);
    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "继任者",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });

    host.disconnect();
    await eventually(
      () => server!.roomService.getRoom(created.room.code).hostPlayerId === joined.playerId,
    );
    const transferred = server.roomService.getRoom(created.room.code);
    expect(transferred.gamePausedForDisconnect).toBe(true);
    expect(transferred.publicAuditLog).toContain("继任者 成为房主");

    await emitAck(guest, "room:mark-dead", { targetPlayerId: created.playerId });
    expect(server.roomService.getRoom(created.room.code)).toMatchObject({
      hostPlayerId: joined.playerId,
      gamePausedForDisconnect: false,
    });

    const formerHost = connect(port);
    sockets.push(formerHost);
    await connected(formerHost);
    const reconnected = await emitAck<SafeRoomEntryResult>(
      formerHost,
      "room:reconnect",
      {
        roomCode: created.room.code,
        reconnectToken: created.reconnectToken,
      },
    );
    expect(reconnected.room.hostPlayerId).toBe(joined.playerId);
    expect(reconnected.room.viewerIsHost).toBe(false);
  });

  it("mirrors an ordinary engine death into the room before later disconnects", async () => {
    server = createGameServer({ gameSeedGenerator: () => 19 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([connected(host), connected(guest)]);
    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "朋友",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });

    const state = server.gameSessionService.getState(created.room.code);
    const senderId = state.activePlayerId;
    const receiverId = state.seatOrder.find((id) => id !== senderId)!;
    const availableCardIds = new Set([
      ...state.drawPile,
      ...Object.values(state.players).flatMap((player) => player.hand),
    ]);
    const blackCards = PHYSICAL_DECK.filter(
      (card) =>
        availableCardIds.has(card.id as PhysicalCardId) &&
        card.color === "黑" &&
        card.name !== "公开文本",
    ).slice(0, 3);
    for (const card of blackCards) detachCard(state, card.id);
    state.players[receiverId].intelligence.push(blackCards[0].id, blackCards[1].id);
    state.players[senderId].hand.push(blackCards[2].id);
    const socketsByPlayer = new Map([
      [created.playerId, host],
      [joined.playerId, guest],
    ]);
    const commandSocket = (playerId: string) => socketsByPlayer.get(playerId)!;

    await emitAck(commandSocket(senderId), "game:command", {
      command: transmissionCommand(blackCards[2], receiverId),
    });
    await emitAck(commandSocket(senderId), "game:command", {
      command: { type: "PASS_LOCK" },
    });
    while (state.reactionWindow) {
      const responderId =
        state.reactionWindow.responderOrder[state.reactionWindow.nextResponderIndex];
      await emitAck(commandSocket(responderId), "game:command", {
        command: { type: "PASS_REACTION" },
      });
    }
    await emitAck(commandSocket(receiverId), "game:command", {
      command: { type: "ACCEPT_INTELLIGENCE" },
    });

    expect(state.players[receiverId]).toMatchObject({
      alive: false,
      factionRevealed: true,
    });
    expect(
      server.roomService
        .getRoom(created.room.code)
        .players.find((player) => player.id === receiverId),
    ).toMatchObject({ alive: false });
    commandSocket(receiverId).disconnect();
    await eventually(
      () => !server!.roomService.getRoom(created.room.code).gamePausedForDisconnect,
    );
  });
});

function transmissionCommand(card: PhysicalCard, targetId: string): GameCommand {
  return {
    type: "START_TRANSMISSION",
    cardId: card.id as PhysicalCardId,
    ...(card.transmission === "任意" ? { method: "直达" as const } : {}),
    ...(card.transmission === "直达" || card.transmission === "任意"
      ? { targetId }
      : {}),
    ...(card.circle && card.transmission !== "直达"
      ? { direction: "clockwise" as const }
      : {}),
  };
}

function detachCard(state: GameState, cardId: string): void {
  for (const player of Object.values(state.players)) {
    player.hand = player.hand.filter((id) => id !== cardId);
    player.intelligence = player.intelligence.filter((id) => id !== cardId);
  }
  state.drawPile = state.drawPile.filter((id) => id !== cardId);
  state.publicDiscard = state.publicDiscard.filter((id) => id !== cardId);
}

function connect(port: number): TestSocket {
  return createClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
}

function connected(socket: TestSocket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
}

function onceEvent<E extends keyof ServerToClientEvents>(
  socket: TestSocket,
  event: E,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve) => socket.once(event, resolve as never));
}

function emitAck<T>(
  socket: TestSocket,
  event: keyof ClientToServerEvents,
  request: unknown,
): Promise<T> {
  return emitRawAck(socket, event, request).then((result) => {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.data as T;
  });
}

function emitRawAck(
  socket: TestSocket,
  event: keyof ClientToServerEvents,
  request: unknown,
): Promise<Ack<unknown>> {
  return new Promise((resolve) => {
    (socket.emit as (...args: unknown[]) => void)(event, request, resolve);
  });
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not reached");
}
