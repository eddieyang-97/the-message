import type { RoomService } from "../room";
import type { GameCommand, GameSessionService } from "./game-session";
import {
  chooseBotCommand,
  createBotMemory,
  createSeededBotRandom,
  type BotMemory,
  type BotRandom,
} from "./bot-strategy";

export interface BotRunnerClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BotRunnerOptions {
  rooms: RoomService;
  games: GameSessionService;
  dispatch(roomCode: string, actorId: string, command: GameCommand): void;
  onAdvanced(roomCode: string): void | Promise<void>;
  delayMs?: number;
  clock?: BotRunnerClock;
  randomForBot?: (roomCode: string, botId: string) => BotRandom;
}

interface ScheduledBotTurn {
  fingerprint: string;
  handle: unknown;
}

const systemClock: BotRunnerClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Advances server-owned bot seats through the same command dispatcher as humans. */
export class BotRunner {
  private readonly scheduled = new Map<string, ScheduledBotTurn>();
  private readonly memories = new Map<string, BotMemory>();
  private readonly randoms = new Map<string, BotRandom>();
  private readonly rejected = new Map<string, GameCommand[]>();
  private readonly clock: BotRunnerClock;
  private readonly delayMs: number;

  constructor(private readonly options: BotRunnerOptions) {
    this.clock = options.clock ?? systemClock;
    this.delayMs = options.delayMs ?? 650;
  }

  reconcile(roomCode: string): void {
    const candidate = this.currentCandidate(roomCode);
    const existing = this.scheduled.get(roomCode);
    if (!candidate) {
      if (existing) this.cancel(roomCode);
      return;
    }

    const fingerprint = `${candidate.actorId}:${candidate.projection.auditLog.length}:${candidate.projection.phase}:${JSON.stringify(candidate.command)}`;
    if (existing?.fingerprint === fingerprint) return;
    if (existing) this.cancel(roomCode);

    const scheduled: ScheduledBotTurn = {
      fingerprint,
      handle: this.clock.setTimeout(
        () => void this.advance(roomCode, fingerprint),
        this.delayMs,
      ),
    };
    this.scheduled.set(roomCode, scheduled);
  }

  clear(roomCode: string): void {
    this.cancel(roomCode);
    for (const key of this.memories.keys()) {
      if (key.startsWith(`${roomCode}:`)) this.memories.delete(key);
    }
    for (const key of this.randoms.keys()) {
      if (key.startsWith(`${roomCode}:`)) this.randoms.delete(key);
    }
  }

  releasePlayer(roomCode: string, playerId: string): void {
    this.cancel(roomCode);
    const key = `${roomCode}:${playerId}`;
    this.memories.delete(key);
    this.randoms.delete(key);
    for (const stateKey of this.rejected.keys()) {
      if (stateKey.startsWith(`${key}:`)) this.rejected.delete(stateKey);
    }
  }

  close(): void {
    for (const roomCode of [...this.scheduled.keys()]) this.cancel(roomCode);
    this.memories.clear();
    this.randoms.clear();
    this.rejected.clear();
  }

  private async advance(roomCode: string, fingerprint: string): Promise<void> {
    const scheduled = this.scheduled.get(roomCode);
    if (!scheduled || scheduled.fingerprint !== fingerprint) return;
    this.scheduled.delete(roomCode);

    const candidate = this.currentCandidate(roomCode);
    if (!candidate) return;
    try {
      this.options.dispatch(roomCode, candidate.actorId, candidate.command);
      this.rejected.delete(candidate.stateKey);
      await this.options.onAdvanced(roomCode);
    } catch {
      const rejected = this.rejected.get(candidate.stateKey) ?? [];
      rejected.push(candidate.command);
      this.rejected.set(candidate.stateKey, rejected);
      // This also lets a bot try another transmission card when a secret-order
      // color is intentionally hidden from the target's projection.
      this.reconcile(roomCode);
      return;
    }
    this.reconcile(roomCode);
  }

  private currentCandidate(roomCode: string): {
    actorId: string;
    command: GameCommand;
    projection: ReturnType<GameSessionService["project"]>;
    stateKey: string;
  } | undefined {
    if (!this.options.rooms.hasRoom(roomCode) || !this.options.games.has(roomCode)) {
      return undefined;
    }
    const room = this.options.rooms.getRoom(roomCode);
    if (room.gamePausedForDisconnect) return undefined;
    const game = this.options.games.getState(roomCode);
    if (game.phase === "gameOver") return undefined;

    let candidate: {
      actorId: string;
      command: GameCommand;
      projection: ReturnType<GameSessionService["project"]>;
      stateKey: string;
    } | undefined;
    for (const player of room.players) {
      if ((!player.isBot && !player.botControlled) || !player.alive) continue;
      const projection = this.options.games.project(roomCode, player.id);
      const key = `${roomCode}:${player.id}`;
      const memory = this.memories.get(key) ?? createBotMemory(projection);
      this.memories.set(key, memory);
      const random = this.randoms.get(key) ?? this.createRandom(roomCode, player.id);
      this.randoms.set(key, random);
      const stateKey = `${key}:${projection.auditLog.length}:${projection.phase}`;
      const command = chooseBotCommand(projection, memory, {
        random,
        excludedCommands: this.rejected.get(stateKey),
        excludedTransmissionCardIds: (this.rejected.get(stateKey) ?? [])
          .filter(
            (command): command is Extract<GameCommand, { type: "START_TRANSMISSION" }> =>
              command.type === "START_TRANSMISSION",
          )
          .map((command) => command.cardId),
      });
      if (command && !candidate) {
        candidate = { actorId: player.id, command, projection, stateKey };
      }
    }
    return candidate;
  }

  private createRandom(roomCode: string, botId: string): BotRandom {
    if (this.options.randomForBot) return this.options.randomForBot(roomCode, botId);
    let seed = 0x811c9dc5;
    for (const character of `${roomCode}:${botId}`) {
      seed ^= character.charCodeAt(0);
      seed = Math.imul(seed, 0x01000193);
    }
    return createSeededBotRandom(seed);
  }

  private cancel(roomCode: string): void {
    const scheduled = this.scheduled.get(roomCode);
    if (!scheduled) return;
    this.clock.clearTimeout(scheduled.handle);
    this.scheduled.delete(roomCode);
  }
}
