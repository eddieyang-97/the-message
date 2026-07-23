import type { AddressInfo } from "node:net";

import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import {
  PHYSICAL_DECK,
  type PhysicalCard,
  type PhysicalCardId,
} from "../game/cards";
import {
  currentReactionWindow,
  currentResolutionContext,
  enterTransmissionPhase,
  passLockOpportunity,
  passReaction,
  startTransmission,
  topResponseFrame,
  type GameState,
  type PlayerProjection,
} from "../game/engine";
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

  it("lets the host manage bot seats and start a bot-filled room", async () => {
    server = createGameServer({ gameSeedGenerator: () => 42, botDelayMs: 60_000 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    sockets.push(host);
    await connected(host);

    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    expect(await emitRawAck(host, "room:bot:add", { seatIndex: 1 })).toMatchObject({
      ok: true,
    });
    const bot = server.roomService
      .getRoom(created.room.code)
      .players.find((player) => player.isBot);
    expect(bot).toMatchObject({ seatIndex: 1, connected: true });

    expect(await emitRawAck(host, "room:bot:remove", {
      targetPlayerId: bot!.id,
    })).toMatchObject({ ok: true });
    expect(await emitRawAck(host, "room:bot:fill", {})).toMatchObject({ ok: true });
    const started = await emitAck<SafeStartRoomResult>(host, "room:start", {
      seatMode: "as-is",
    });
    expect(started.seatOrder).toHaveLength(2);
    expect(server.roomService.getRoom(created.room.code).phase).toBe("started");
  });

  it("allows reconnectable spectators without exposing private game state", async () => {
    server = createGameServer({ gameSeedGenerator: () => 42, botDelayMs: 60_000 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const spectator = connect(port);
    sockets.push(host, spectator);
    await Promise.all([connected(host), connected(spectator)]);
    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "房主",
    });
    const watching = await emitAck<SafeRoomEntryResult>(spectator, "room:spectate", {
      roomCode: created.room.code,
      displayName: "观众",
    });
    expect(watching.isSpectator).toBe(true);
    expect(watching.room.spectators).toContainEqual(
      expect.objectContaining({ displayName: "观众", connected: true }),
    );
    await emitAck(host, "room:bot:add", { seatIndex: 1 });
    const spectatorGame = onceEvent(spectator, "game:spectator-snapshot");
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });
    const projection = await spectatorGame;
    expect(projection.spectator).toBe(true);
    expect("own" in projection).toBe(false);
    expect("legalActions" in projection).toBe(false);
    expect(await emitRawAck(spectator, "game:command", {
      command: { type: "PASS_REACTION" },
    })).toMatchObject({ ok: false, error: { code: "NOT_A_GAME_PLAYER" } });

    const spectatorRoom = onceEvent(spectator, "room:snapshot");
    expect(await emitRawAck(host, "room:chat", { text: "欢迎旁观" })).toMatchObject({
      ok: true,
    });
    expect((await spectatorRoom).chatMessages.at(-1)).toMatchObject({
      playerId: created.playerId,
      text: "欢迎旁观",
    });
    const hostReceivesSpectatorChat = onceEvent(host, "room:snapshot");
    expect(await emitRawAck(spectator, "room:chat", { text: "观众发言" })).toMatchObject({
      ok: true,
    });
    expect((await hostReceivesSpectatorChat).chatMessages.at(-1)).toMatchObject({
      playerId: watching.playerId,
      text: "观众发言",
    });
  });

  it("accepts a two-card active player's burn and the opponent's counter in a duel", async () => {
    server = createGameServer({ gameSeedGenerator: () => 42, botDelayMs: 60_000 });
    await server.listen(0, "127.0.0.1");
    const port = (server.httpServer.address() as AddressInfo).port;
    const host = connect(port);
    const guest = connect(port);
    sockets.push(host, guest);
    await Promise.all([connected(host), connected(guest)]);

    const created = await emitAck<SafeRoomEntryResult>(host, "room:create", {
      capacity: 2,
      displayName: "Eddie",
    });
    const joined = await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "e2",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });

    const state = server.gameSessionService.getState(created.room.code);
    const socketsByPlayer = new Map([
      [created.playerId, host],
      [joined.playerId, guest],
    ]);
    const activeId = state.activePlayerId;
    const opponentId = state.seatOrder.find((id) => id !== activeId)!;
    const burn = PHYSICAL_DECK.find((card) => card.name === "烧毁")!;
    const counter = PHYSICAL_DECK.find((card) => card.name === "识破")!;
    const remaining = PHYSICAL_DECK.find((card) =>
      card.id !== burn.id && card.id !== counter.id && card.name === "转移"
    )!;
    const excludedIntelligenceIds: readonly string[] = [
      burn.id,
      counter.id,
      remaining.id,
    ];
    const intelligence = PHYSICAL_DECK.find((card) =>
      card.color === "黑" && !card.unburnable &&
      !excludedIntelligenceIds.includes(card.id)
    )!;

    for (const player of Object.values(state.players)) {
      state.drawPile.push(...player.hand);
      player.hand = [];
    }
    for (const card of [burn, counter, remaining, intelligence]) detachCard(state, card.id);
    state.players[activeId].hand.push(
      burn.id as PhysicalCardId,
      remaining.id as PhysicalCardId,
    );
    state.players[activeId].intelligence.push(intelligence.id as PhysicalCardId);
    state.players[opponentId].hand.push(counter.id as PhysicalCardId);

    const burnResult = await emitRawAck(socketsByPlayer.get(activeId)!, "game:command", {
      command: {
        type: "PLAY_BURN",
        cardId: burn.id as PhysicalCardId,
        targetPlayerId: activeId,
        targetIntelligenceCardId: intelligence.id as PhysicalCardId,
      },
    });
    expect(burnResult).toMatchObject({ ok: true });
    expect(state.players[activeId].hand).toEqual([remaining.id]);
    expect(currentReactionWindow(state)).toMatchObject({
      kind: "burn",
      affectedPlayerId: activeId,
    });

    const burnFrame = topResponseFrame(state)!;
    const counterResult = await emitRawAck(socketsByPlayer.get(opponentId)!, "game:command", {
      command: {
        type: "PLAY_COUNTER",
        cardId: counter.id as PhysicalCardId,
        targetInteractionId: burnFrame.id,
      },
    });
    expect(counterResult).toMatchObject({ ok: true });
    const burnContext = currentResolutionContext(state);
    expect(burnContext?.kind === "burn" && burnContext.burn?.countered).toBe(true);

    while (currentReactionWindow(state)?.kind === "burn") {
      const responderId = currentReactionWindow(state)!.responderOrder[
        currentReactionWindow(state)!.nextResponderIndex
      ];
      expect(await emitRawAck(socketsByPlayer.get(responderId)!, "game:command", {
        command: { type: "PASS_REACTION" },
      })).toMatchObject({ ok: true });
    }
    expect(state.players[activeId].intelligence).toContain(intelligence.id);
    expect(state.auditLog.at(-1)).toBe("烧毁被识破，目标情报保持不变");
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
    expect(started.room.publicAuditEvents.slice(-5).map((event) => event.source)).toEqual([
      "room",
      "game",
      "game",
      "game",
      "game",
    ]);
    expect(started.room.publicAuditEvents.at(-1)?.text).toContain("首回合开始时摸2张牌");
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
    expect(server.roomService.getRoom(created.room.code).publicAuditEvents.at(-1)).toMatchObject({
      source: "room",
      text: "朋友 已断开连接",
    });
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

  it("lets a refreshed socket atomically replace the still-connected socket", async () => {
    server = createGameServer({ gameSeedGenerator: () => 8 });
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
    await emitAck<SafeRoomEntryResult>(guest, "room:join", {
      roomCode: created.room.code,
      displayName: "朋友",
    });
    await emitAck<SafeStartRoomResult>(host, "room:start", { seatMode: "as-is" });

    const refreshed = connect(port);
    sockets.push(refreshed);
    await connected(refreshed);
    const projectionPromise = onceEvent(refreshed, "game:snapshot");
    const reconnected = await emitAck<SafeRoomEntryResult>(
      refreshed,
      "room:reconnect",
      {
        roomCode: created.room.code,
        reconnectToken: created.reconnectToken,
      },
    );
    const projection = await projectionPromise;

    expect(reconnected.playerId).toBe(created.playerId);
    expect(projection.own.id).toBe(created.playerId);
    expect(host.connected).toBe(false);
    const room = server.roomService.getRoom(created.room.code);
    expect(room.players.find((player) => player.id === created.playerId)?.connected)
      .toBe(true);
    expect(room.gamePausedForDisconnect).toBe(false);
  });

  it("returns every player to the same lobby after the host starts a new game", async () => {
    server = createGameServer({ gameSeedGenerator: () => 17 });
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
    const game = server.gameSessionService.getState(created.room.code);
    game.phase = "gameOver";
    game.winner = { kind: "agent", playerId: game.activePlayerId };
    game.players[joined.playerId].alive = false;
    server.roomService.synchronizePlayerDeaths(created.room.code, [joined.playerId]);
    const hostLobby = onceEvent(host, "room:snapshot");
    const guestLobby = onceEvent(guest, "room:snapshot");

    await emitAck(host, "room:new-game", {});
    const [hostRoom, guestRoom] = await Promise.all([hostLobby, guestLobby]);

    expect(hostRoom.phase).toBe("lobby");
    expect(guestRoom.phase).toBe("lobby");
    expect(hostRoom.code).toBe(created.room.code);
    expect(guestRoom.players.every((player) => player.alive)).toBe(true);
    expect(server.gameSessionService.has(created.room.code)).toBe(false);
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

  it("lets the host assign temporary AI control and returns control on reconnect", async () => {
    server = createGameServer({ gameSeedGenerator: () => 7, botDelayMs: 60_000 });
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
    await eventually(
      () => server!.roomService.getRoom(created.room.code).gamePausedForDisconnect,
    );

    await emitAck(host, "room:bot:takeover", {
      targetPlayerId: joined.playerId,
      enabled: true,
    });
    expect(server.roomService.getRoom(created.room.code)).toMatchObject({
      gamePausedForDisconnect: false,
      players: expect.arrayContaining([
        expect.objectContaining({
          id: joined.playerId,
          connected: false,
          botControlled: true,
        }),
      ]),
    });

    const returning = connect(port);
    sockets.push(returning);
    await connected(returning);
    const reconnected = await emitAck<SafeRoomEntryResult>(returning, "room:reconnect", {
      roomCode: created.room.code,
      reconnectToken: joined.reconnectToken,
    });
    expect(reconnected.room.players.find((player) => player.id === joined.playerId))
      .toMatchObject({ connected: true, botControlled: false });
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
    while (currentReactionWindow(state)) {
      const responderId =
        currentReactionWindow(state)!.responderOrder[currentReactionWindow(state)!.nextResponderIndex];
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

  it("accepts 掉包 through the server after a transfer response window resolves", async () => {
    server = createGameServer({ gameSeedGenerator: () => 82, botDelayMs: 60_000 });
    const fixture = await createTransferBoundaryFixture(server, sockets);

    expect(currentReactionWindow(fixture.state)?.kind).toBe("transfer");
    expect(await emitRawAck(fixture.reactorSocket, "game:command", {
      command: { type: "PLAY_SWAP", cardId: fixture.swapCardId },
    })).toMatchObject({ ok: false });
    expect(await emitRawAck(fixture.reactorSocket, "game:command", {
      command: { type: "PLAY_INTERCEPT", cardId: fixture.interceptCardId },
    })).toMatchObject({ ok: false });

    const transferProjection = server.gameSessionService.project(
      fixture.roomCode,
      fixture.reactorId,
    );
    expect(transferProjection.legalActions).toContainEqual(expect.objectContaining({
      type: "PLAY_COUNTER",
      cardId: fixture.counterCardId,
    }));

    await passTransferWindowThroughServer(fixture);

    expect(currentReactionWindow(fixture.state)).toMatchObject({
      kind: "intelligence",
      affectedPlayerId: fixture.transferredTargetId,
    });
    expect(fixture.state.transmission).toMatchObject({
      intendedRecipientId: fixture.transferredTargetId,
      transferredRecipientCommitted: true,
    });
    expect(server.gameSessionService.project(fixture.roomCode, fixture.reactorId).legalActions)
      .toContainEqual({ type: "PLAY_SWAP", cardId: fixture.swapCardId });

    const accepted = await emitRawAck(fixture.reactorSocket, "game:command", {
      command: { type: "PLAY_SWAP", cardId: fixture.swapCardId },
    });

    expect(accepted).toMatchObject({ ok: true });
    expect(currentReactionWindow(fixture.state)?.kind).toBe("swap");
    expect(fixture.state.transmission).toMatchObject({
      intendedRecipientId: fixture.transferredTargetId,
      transferredRecipientCommitted: true,
      pendingSwap: { sourceCardId: fixture.swapCardId },
    });
  });

  it("accepts 截获 through the server after a transfer response window resolves", async () => {
    server = createGameServer({ gameSeedGenerator: () => 83, botDelayMs: 60_000 });
    const fixture = await createTransferBoundaryFixture(server, sockets);

    expect(currentReactionWindow(fixture.state)?.kind).toBe("transfer");
    expect(await emitRawAck(fixture.reactorSocket, "game:command", {
      command: { type: "PLAY_INTERCEPT", cardId: fixture.interceptCardId },
    })).toMatchObject({ ok: false });

    await passTransferWindowThroughServer(fixture);

    expect(currentReactionWindow(fixture.state)).toMatchObject({
      kind: "intelligence",
      affectedPlayerId: fixture.transferredTargetId,
    });
    expect(server.gameSessionService.project(fixture.roomCode, fixture.reactorId).legalActions)
      .toContainEqual({ type: "PLAY_INTERCEPT", cardId: fixture.interceptCardId });

    const accepted = await emitRawAck(fixture.reactorSocket, "game:command", {
      command: { type: "PLAY_INTERCEPT", cardId: fixture.interceptCardId },
    });

    expect(accepted).toMatchObject({ ok: true });
    expect(currentReactionWindow(fixture.state)).toMatchObject({
      kind: "intelligence",
      affectedPlayerId: fixture.reactorId,
    });
    expect(fixture.state.transmission).toMatchObject({
      intendedRecipientId: fixture.reactorId,
      interceptorCommitted: true,
      transferredRecipientCommitted: false,
    });
  });

  it("accepts 识破 through the server when it counters 转移", async () => {
    server = createGameServer({ gameSeedGenerator: () => 84, botDelayMs: 60_000 });
    const fixture = await createTransferBoundaryFixture(server, sockets);
    const counter = server.gameSessionService
      .project(fixture.roomCode, fixture.reactorId)
      .legalActions.find((action) => action.type === "PLAY_COUNTER");
    if (!counter || counter.type !== "PLAY_COUNTER") throw new Error("Expected transfer counter");

    const accepted = await emitRawAck(fixture.reactorSocket, "game:command", {
      command: counter,
    });

    expect(accepted).toMatchObject({ ok: true });
    expect(currentReactionWindow(fixture.state)?.kind).toBe("transfer");
    expect(topResponseFrame(fixture.state)).toMatchObject({
      kind: "counter",
      sourcePlayerId: fixture.reactorId,
    });
    expect(fixture.state.transmission?.pendingTransfer).toBeUndefined();
    expect(fixture.state.players[fixture.reactorId].hand).not.toContain(fixture.counterCardId);

    await passTransferWindowThroughServer(fixture);

    expect(currentReactionWindow(fixture.state)).toBeUndefined();
    expect(fixture.state.transmission).toMatchObject({
      intendedRecipientId: fixture.originalRecipientId,
      receiptStage: "decision",
      transferredRecipientCommitted: false,
    });
  });
});

interface TransferBoundaryFixture {
  roomCode: string;
  state: GameState;
  socketsByPlayer: Map<string, TestSocket>;
  reactorId: string;
  reactorSocket: TestSocket;
  originalRecipientId: string;
  transferredTargetId: string;
  swapCardId: PhysicalCardId;
  interceptCardId: PhysicalCardId;
  counterCardId: PhysicalCardId;
}

async function createTransferBoundaryFixture(
  server: GameServer,
  sockets: TestSocket[],
): Promise<TransferBoundaryFixture> {
  await server.listen(0, "127.0.0.1");
  const port = (server.httpServer.address() as AddressInfo).port;
  const clients = Array.from({ length: 5 }, () => connect(port));
  sockets.push(...clients);
  await Promise.all(clients.map(connected));
  const created = await emitAck<SafeRoomEntryResult>(clients[0], "room:create", {
    capacity: 5,
    displayName: "玩家1",
  });
  const entries = [created];
  for (let index = 1; index < clients.length; index += 1) {
    entries.push(await emitAck<SafeRoomEntryResult>(clients[index], "room:join", {
      roomCode: created.room.code,
      displayName: `玩家${index + 1}`,
    }));
  }
  await emitAck<SafeStartRoomResult>(clients[0], "room:start", { seatMode: "as-is" });

  const socketsByPlayer = new Map(entries.map((entry, index) => [entry.playerId, clients[index]]));
  const state = server.gameSessionService.getState(created.room.code);
  const senderIndex = state.seatOrder.indexOf(state.activePlayerId);
  const senderId = state.activePlayerId;
  const originalRecipientId = state.seatOrder[(senderIndex + 1) % state.seatOrder.length];
  const transferredTargetId = state.seatOrder[(senderIndex + 2) % state.seatOrder.length];
  const reactorId = state.seatOrder[(senderIndex + 3) % state.seatOrder.length];
  const intelligence = PHYSICAL_DECK.find((card) =>
    card.transmission === "直达" && !["转移", "掉包", "截获", "识破"].includes(card.name)
  )!;
  const transfer = PHYSICAL_DECK.find((card) => card.name === "转移")!;
  const swap = PHYSICAL_DECK.find((card) => card.name === "掉包")!;
  const intercept = PHYSICAL_DECK.find((card) => card.name === "截获")!;
  const counter = PHYSICAL_DECK.find((card) => card.name === "识破")!;
  for (const card of [intelligence, transfer, swap, intercept, counter]) detachCard(state, card.id);
  state.players[senderId].hand.push(intelligence.id as PhysicalCardId);
  state.players[originalRecipientId].hand.push(transfer.id as PhysicalCardId);
  state.players[reactorId].hand.push(
    swap.id as PhysicalCardId,
    intercept.id as PhysicalCardId,
    counter.id as PhysicalCardId,
  );

  enterTransmissionPhase(state, senderId);
  while (currentReactionWindow(state)) {
    passReaction(
      state,
      currentReactionWindow(state)!.responderOrder[currentReactionWindow(state)!.nextResponderIndex],
    );
  }
  startTransmission(state, senderId, intelligence.id as PhysicalCardId, {
    targetId: originalRecipientId,
  });
  passLockOpportunity(state, senderId);
  while (true) {
    const window = currentReactionWindow(state);
    if (!window) throw new Error("Expected initial intelligence reaction window");
    const responderId = window.responderOrder[window.nextResponderIndex];
    if (responderId === originalRecipientId) break;
    passReaction(state, responderId);
  }
  const transferAccepted = await emitRawAck(socketsByPlayer.get(originalRecipientId)!, "game:command", {
    command: {
      type: "PLAY_TRANSFER",
      cardId: transfer.id as PhysicalCardId,
      targetId: transferredTargetId,
    },
  });
  expect(transferAccepted).toMatchObject({ ok: true });
  expect(currentReactionWindow(state)).toMatchObject({
    kind: "transfer",
    affectedPlayerId: transferredTargetId,
  });

  return {
    roomCode: created.room.code,
    state,
    socketsByPlayer,
    reactorId,
    reactorSocket: socketsByPlayer.get(reactorId)!,
    originalRecipientId,
    transferredTargetId,
    swapCardId: swap.id as PhysicalCardId,
    interceptCardId: intercept.id as PhysicalCardId,
    counterCardId: counter.id as PhysicalCardId,
  };
}

async function passTransferWindowThroughServer(fixture: TransferBoundaryFixture): Promise<void> {
  while (currentReactionWindow(fixture.state)?.kind === "transfer") {
    const responderId = currentReactionWindow(fixture.state)!.responderOrder[
      currentReactionWindow(fixture.state)!.nextResponderIndex
    ];
    await emitAck<PlayerProjection>(fixture.socketsByPlayer.get(responderId)!, "game:command", {
      command: { type: "PASS_REACTION" },
    });
  }
}

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
