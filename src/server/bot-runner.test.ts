import { describe, expect, it } from "vitest";

import { RoomService } from "../room";
import { BotRunner, type BotRunnerClock } from "./bot-runner";
import { GameSessionService } from "./game-session";

class ManualClock implements BotRunnerClock {
  callbacks: Array<() => void> = [];

  setTimeout(callback: () => void): unknown {
    this.callbacks.push(callback);
    return callback;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks = this.callbacks.filter((callback) => callback !== handle);
  }

  runNext(): void {
    this.callbacks.shift()?.();
  }
}

describe("BotRunner", () => {
  it("advances a bot through the normal authoritative command dispatcher", async () => {
    let playerSequence = 0;
    const rooms = new RoomService({
      roomCodeGenerator: () => "BOTRUN",
      playerIdGenerator: () => `human-${++playerSequence}`,
      reconnectTokenGenerator: () => `token-${playerSequence}`,
      botIdGenerator: () => "bot-1",
      random: () => 0,
    });
    const host = rooms.createRoom(2, "Host");
    const lobby = rooms.addBot(host.room.code, host.playerId, 1);
    const started = rooms.startRoom(host.room.code, host.playerId, "as-is");
    const bot = lobby.players.find((player) => player.isBot)!;
    const games = new GameSessionService();
    games.create(started.room.code, started.seatOrder, 4);
    expect(games.getState(started.room.code).activePlayerId).toBe(bot.id);

    const clock = new ManualClock();
    const commands: string[] = [];
    const runner = new BotRunner({
      rooms,
      games,
      clock,
      delayMs: 1,
      dispatch: (roomCode, actorId, command) => {
        commands.push(command.type);
        games.dispatch(roomCode, actorId, command);
      },
      onAdvanced: () => undefined,
    });

    runner.reconcile(started.room.code);
    expect(clock.callbacks).toHaveLength(1);
    clock.runNext();
    await Promise.resolve();
    await Promise.resolve();

    expect(commands).toEqual(["ENTER_TRANSMISSION_PHASE"]);
    expect(games.getState(started.room.code).phase).toBe("preTransmission");
    // The bot stops while the human receives the secret-order reaction prompt.
    expect(clock.callbacks).toHaveLength(0);
    runner.close();
  });

  it("tries another command when an unchanged bot state rejects its first choice", async () => {
    let playerSequence = 0;
    const rooms = new RoomService({
      roomCodeGenerator: () => "RETRYB",
      playerIdGenerator: () => `human-${++playerSequence}`,
      reconnectTokenGenerator: () => `token-${playerSequence}`,
      botIdGenerator: () => "bot-1",
      random: () => 0,
    });
    const host = rooms.createRoom(2, "Host");
    const lobby = rooms.addBot(host.room.code, host.playerId, 1);
    const started = rooms.startRoom(host.room.code, host.playerId, "as-is");
    const bot = lobby.players.find((player) => player.isBot)!;
    const games = new GameSessionService();
    games.create(started.room.code, started.seatOrder, 4);
    games.dispatch(started.room.code, bot.id, { type: "ENTER_TRANSMISSION_PHASE" });
    games.dispatch(started.room.code, host.playerId, { type: "PASS_REACTION" });

    const clock = new ManualClock();
    const attempted: string[] = [];
    let rejectFirst = true;
    const runner = new BotRunner({
      rooms,
      games,
      clock,
      delayMs: 1,
      dispatch: (roomCode, actorId, command) => {
        attempted.push(JSON.stringify(command));
        if (rejectFirst) {
          rejectFirst = false;
          throw new Error("simulated authoritative rejection");
        }
        games.dispatch(roomCode, actorId, command);
      },
      onAdvanced: () => undefined,
    });

    runner.reconcile(started.room.code);
    clock.runNext();
    await Promise.resolve();
    expect(clock.callbacks).toHaveLength(1);
    clock.runNext();
    await Promise.resolve();
    await Promise.resolve();

    expect(attempted).toHaveLength(2);
    expect(attempted[1]).not.toBe(attempted[0]);
    expect(JSON.parse(attempted[1]!).cardId).not.toBe(JSON.parse(attempted[0]!).cardId);
    expect(games.getState(started.room.code).phase).toBe("transmitting");
    runner.close();
  });

  it("runs a disconnected human seat while temporary AI control is enabled", () => {
    let playerSequence = 0;
    const rooms = new RoomService({
      roomCodeGenerator: () => "TAKEOV",
      playerIdGenerator: () => `player-${++playerSequence}`,
      reconnectTokenGenerator: () => `token-${playerSequence}`,
      random: () => 0,
    });
    const host = rooms.createRoom(2, "Host");
    const guest = rooms.joinRoom(host.room.code, "Guest");
    const started = rooms.startRoom(host.room.code, host.playerId, "as-is");
    rooms.disconnect(started.room.code, guest.playerId);
    rooms.setBotTakeover(started.room.code, host.playerId, guest.playerId, true);
    const games = new GameSessionService();
    games.create(started.room.code, started.seatOrder, 4);
    expect(games.getState(started.room.code).activePlayerId).toBe(guest.playerId);

    const clock = new ManualClock();
    const runner = new BotRunner({
      rooms,
      games,
      clock,
      dispatch: (roomCode, actorId, command) => {
        games.dispatch(roomCode, actorId, command);
      },
      onAdvanced: () => undefined,
    });
    runner.reconcile(started.room.code);

    expect(clock.callbacks).toHaveLength(1);
    runner.releasePlayer(started.room.code, guest.playerId);
    expect(clock.callbacks).toHaveLength(0);
    runner.close();
  });
});
