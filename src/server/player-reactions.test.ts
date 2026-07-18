import type { AddressInfo } from "node:net";

import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import type { PlayerReactionEvent } from "../social-reactions";
import type {
  Ack,
  ClientToServerEvents,
  SafeRoomEntryResult,
  SafeStartRoomResult,
  ServerToClientEvents,
} from "./protocol";
import { createGameServer, type GameServer } from "./server";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

describe("玩家即时互动", () => {
  let server: GameServer | undefined;
  const sockets: TestSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.disconnect();
    sockets.length = 0;
    await server?.close();
    server = undefined;
  });

  it("只允许游戏玩家向另一名玩家发送送花或番茄并向全房广播", async () => {
    server = createGameServer({ gameSeedGenerator: () => 42, botDelayMs: 60_000 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    const spectator = connect(port);
    sockets.push(host, guest, spectator);
    await Promise.all(sockets.map(connected));

    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "朋友",
    });
    await emitAck<SafeRoomEntryResult>(spectator, "room:spectate", {
      roomCode: created.room.code,
      displayName: "观众",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });

    const receivedByGuest = onceEvent(guest, "game:player-reaction");
    const sent = await emitAck<PlayerReactionEvent>(host, "game:player-reaction", {
      kind: "flower",
      targetPlayerId: joined.playerId,
    });
    await expect(receivedByGuest).resolves.toEqual(sent);
    expect(sent).toMatchObject({
      kind: "flower",
      fromPlayerId: created.playerId,
      targetPlayerId: joined.playerId,
    });

    await expectRawFailure(host, { kind: "tomato", targetPlayerId: created.playerId }, "INVALID_REACTION_TARGET");
    await expectRawFailure(host, { kind: "wave", targetPlayerId: joined.playerId }, "INVALID_PLAYER_REACTION");
    await expectRawFailure(spectator, { kind: "tomato", targetPlayerId: joined.playerId }, "NOT_A_GAME_PLAYER");
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

async function expectRawFailure(
  socket: TestSocket,
  request: unknown,
  code: string,
): Promise<void> {
  await expect(emitRawAck(socket, "game:player-reaction", request)).resolves.toMatchObject({
    ok: false,
    error: { code },
  });
}
