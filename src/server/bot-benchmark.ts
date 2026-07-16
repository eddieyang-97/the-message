import { factionsForPlayerCount, type WinnerState } from "../game/engine";
import { chooseBotCommand, createBotMemory, createSeededBotRandom, type BotMemory } from "./bot-strategy";
import { GameSessionService, type GameCommand } from "./game-session";

export interface SelfPlayGameOptions {
  playerCount: 2 | 5 | 6 | 7 | 8;
  seed: number;
  maxCommands?: number;
}

export interface SelfPlayGameResult {
  seed: number;
  playerCount: number;
  winner?: WinnerState;
  commands: number;
  turns: number;
  deaths: number;
  rejectedCommands: number;
  status: "completed" | "stalled" | "commandLimit";
  finalPhase: string;
  waitingFor?: string;
  lastPublicEvent?: string;
  lastRejection?: string;
}

export interface SelfPlayBenchmarkOptions {
  playerCount: SelfPlayGameOptions["playerCount"];
  games: number;
  startSeed?: number;
  maxCommandsPerGame?: number;
}

export interface SelfPlayBenchmarkResult {
  playerCount: number;
  games: number;
  completed: number;
  stalled: number;
  commandLimited: number;
  averageCommands: number;
  averageTurns: number;
  rejectedCommands: number;
  winners: Record<string, number>;
  results: SelfPlayGameResult[];
}

/** Runs one game using only player projections, the same information available to live bots. */
export function runSelfPlayGame(options: SelfPlayGameOptions): SelfPlayGameResult {
  const ids = Array.from({ length: options.playerCount }, (_, index) => `bot-${index + 1}`);
  const roomCode = `BENCH-${options.seed}`;
  const games = new GameSessionService();
  games.create(roomCode, ids, options.seed);
  const memories = new Map<string, BotMemory>();
  const randoms = new Map(ids.map((id, index) => [id, createSeededBotRandom(options.seed * 131 + index + 1)]));
  const rejectedByState = new Map<string, GameCommand[]>();
  const maxCommands = options.maxCommands ?? 10_000;
  let commands = 0;
  let rejectedCommands = 0;
  let lastRejection: string | undefined;

  while (!games.getState(roomCode).winner && commands < maxCommands) {
    let advanced = false;
    let attempted = false;
    for (const id of ids) {
      const projection = games.project(roomCode, id);
      const memory = memories.get(id) ?? createBotMemory(projection);
      memories.set(id, memory);
      const stateKey = decisionStateKey(id, projection);
      const rejected = rejectedByState.get(stateKey) ?? [];
      const command = chooseBotCommand(projection, memory, {
        random: randoms.get(id),
        excludedCommands: rejected,
        excludedTransmissionCardIds: rejected
          .filter((item): item is Extract<GameCommand, { type: "START_TRANSMISSION" }> => item.type === "START_TRANSMISSION")
          .map((item) => item.cardId),
      });
      if (!command) continue;
      attempted = true;
      try {
        games.dispatch(roomCode, id, command);
        commands += 1;
        advanced = true;
        break;
      } catch (error) {
        rejected.push(command);
        rejectedByState.set(stateKey, rejected);
        rejectedCommands += 1;
        lastRejection = `${JSON.stringify(command)}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (!advanced && !attempted) {
      return summarizeGame(games, roomCode, options, commands, rejectedCommands, "stalled", lastRejection);
    }
  }

  return summarizeGame(
    games,
    roomCode,
    options,
    commands,
    rejectedCommands,
    games.getState(roomCode).winner ? "completed" : "commandLimit",
    lastRejection,
  );
}

export function runSelfPlayBenchmark(options: SelfPlayBenchmarkOptions): SelfPlayBenchmarkResult {
  if (!Number.isInteger(options.games) || options.games < 1) throw new Error("games must be a positive integer");
  factionsForPlayerCount(options.playerCount);
  const startSeed = options.startSeed ?? 1;
  const results = Array.from({ length: options.games }, (_, index) => runSelfPlayGame({
    playerCount: options.playerCount,
    seed: startSeed + index,
    maxCommands: options.maxCommandsPerGame,
  }));
  const winners: Record<string, number> = {};
  for (const result of results) {
    if (!result.winner) continue;
    const key = result.winner.kind === "faction" ? result.winner.faction : "特工（个人）";
    winners[key] = (winners[key] ?? 0) + 1;
  }
  return {
    playerCount: options.playerCount,
    games: options.games,
    completed: results.filter((result) => result.status === "completed").length,
    stalled: results.filter((result) => result.status === "stalled").length,
    commandLimited: results.filter((result) => result.status === "commandLimit").length,
    averageCommands: average(results.map((result) => result.commands)),
    averageTurns: average(results.map((result) => result.turns)),
    rejectedCommands: results.reduce((total, result) => total + result.rejectedCommands, 0),
    winners,
    results,
  };
}

function summarizeGame(
  games: GameSessionService,
  roomCode: string,
  options: SelfPlayGameOptions,
  commands: number,
  rejectedCommands: number,
  status: SelfPlayGameResult["status"],
  lastRejection?: string,
): SelfPlayGameResult {
  const state = games.getState(roomCode);
  return {
    seed: options.seed,
    playerCount: options.playerCount,
    winner: state.winner,
    commands,
    turns: state.auditLog.filter((entry) => entry.includes("回合开始")).length,
    deaths: Object.values(state.players).filter((player) => !player.alive).length,
    rejectedCommands,
    status,
    finalPhase: state.phase,
    waitingFor: state.reactionWindow?.responderOrder[state.reactionWindow.nextResponderIndex]
      ?? state.pendingSecretOrder?.targetPlayerId
      ?? state.activePlayerId,
    lastPublicEvent: state.auditLog.at(-1),
    lastRejection,
  };
}

function decisionStateKey(id: string, projection: ReturnType<GameSessionService["project"]>): string {
  return JSON.stringify([
    id,
    projection.phase,
    projection.auditLog.length,
    projection.reactionWindow?.currentResponderId,
    projection.transmission?.intendedRecipientId,
    projection.transmission?.receiptStage,
    projection.legalActions,
  ]);
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}
