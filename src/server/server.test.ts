import type { AddressInfo } from "node:net";

import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

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
});

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
