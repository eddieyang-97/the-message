import { factionsForPlayerCount, type WinnerState } from "../game/engine";
import { chooseBotCommand, chooseBotDecision, createBotMemory, createSeededBotRandom, factionBeliefsForPolicy, LIVE_BOT_POLICY, type BotDecision, type BotMemory, type BotPolicy, type FactionBelief } from "../server/bot/strategy";
import { GameSessionService, type GameCommand } from "../server/game-session";
import { CANDIDATE_V8 } from "./policies";

export interface SelfPlayGameOptions {
  playerCount: 2 | 5 | 6 | 7 | 8;
  seed: number;
  maxCommands?: number;
  policies?: readonly BotPolicy[];
  comparePolicies?: readonly [BotPolicy, BotPolicy];
}

export interface BotDisagreement {
  seed: number;
  commandNumber: number;
  actorId: string;
  faction: string;
  phase: string;
  reactionKind?: string;
  transmission?: {
    method: string;
    recipientId: string;
    faceUp: boolean;
    cardColor?: string;
  };
  intelligenceCounts: Record<string, { red: number; blue: number; black: number; physical: number }>;
  legalActionTypes: string[];
  policies: readonly [string, string];
  decisions: readonly [BotDecision | undefined, BotDecision | undefined];
  beliefs: readonly [Record<string, FactionBelief>, Record<string, FactionBelief>];
  publicEvent?: string;
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
  participants: Array<{
    id: string;
    seat: number;
    faction: string;
    policy: string;
    won: boolean;
  }>;
  disagreements: BotDisagreement[];
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

export interface PairedTournamentOptions {
  playerCount: SelfPlayGameOptions["playerCount"];
  pairs: number;
  startSeed?: number;
  maxCommandsPerGame?: number;
  candidatePolicy?: BotPolicy;
  baselinePolicy?: BotPolicy;
}

export interface PairedTournamentResult {
  playerCount: number;
  pairs: number;
  games: number;
  completed: number;
  stalled: number;
  commandLimited: number;
  candidate: PolicyPerformanceSummary;
  baseline: PolicyPerformanceSummary;
  pairedWinRateDifference: number;
  confidence95: { low: number; high: number };
  verdict: "candidate" | "baseline" | "inconclusive";
  pairDifferenceMoments: { count: number; sum: number; sumSquares: number };
  results: SelfPlayGameResult[];
}

export interface WinRateSummary {
  wins: number;
  entries: number;
  winRate: number;
}

export interface PolicyPerformanceSummary extends WinRateSummary {
  byFaction: Record<string, WinRateSummary>;
  bySeat: Record<string, WinRateSummary>;
}

/** Runs one game using only player projections, the same information available to live bots. */
export function runSelfPlayGame(options: SelfPlayGameOptions): SelfPlayGameResult {
  const ids = Array.from({ length: options.playerCount }, (_, index) => `bot-${index + 1}`);
  if (options.policies && options.policies.length !== ids.length) {
    throw new Error("policies must contain exactly one policy per player");
  }
  const policies = options.policies ?? ids.map(() => LIVE_BOT_POLICY);
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
  const disagreements: BotDisagreement[] = [];

  while (!games.getState(roomCode).winner && commands < maxCommands) {
    let advanced = false;
    let attempted = false;
    for (const [index, id] of ids.entries()) {
      const projection = games.project(roomCode, id);
      const memory = memories.get(id) ?? createBotMemory(projection);
      memories.set(id, memory);
      const stateKey = decisionStateKey(id, projection);
      const rejected = rejectedByState.get(stateKey) ?? [];
      if (options.comparePolicies) {
        const decisions = options.comparePolicies.map((policy) => chooseBotDecision(
          projection,
          structuredClone(memory),
          {
            policy,
            random: () => 0,
            excludedCommands: rejected,
            excludedTransmissionCardIds: rejected
              .filter((item): item is Extract<GameCommand, { type: "START_TRANSMISSION" }> => item.type === "START_TRANSMISSION")
              .map((item) => item.cardId),
          },
        )) as [BotDecision | undefined, BotDecision | undefined];
        if (JSON.stringify(decisions[0]?.command) !== JSON.stringify(decisions[1]?.command)) {
          disagreements.push(describeDisagreement(
            options.seed,
            commands,
            projection,
            options.comparePolicies,
            decisions,
            memory,
          ));
        }
      }
      const command = chooseBotCommand(projection, memory, {
        policy: policies[index],
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
      return summarizeGame(games, roomCode, options, policies, commands, rejectedCommands, "stalled", disagreements, lastRejection);
    }
  }

  return summarizeGame(
    games,
    roomCode,
    options,
    policies,
    commands,
    rejectedCommands,
    games.getState(roomCode).winner ? "completed" : "commandLimit",
    disagreements,
    lastRejection,
  );
}

export function runPairedTournament(options: PairedTournamentOptions): PairedTournamentResult {
  if (!Number.isInteger(options.pairs) || options.pairs < 1) throw new Error("pairs must be a positive integer");
  factionsForPlayerCount(options.playerCount);
  const firstLeg = Array.from({ length: options.playerCount }, (_, index): BotPolicy =>
    index % 2 === 0 ? (options.candidatePolicy ?? CANDIDATE_V8) : (options.baselinePolicy ?? LIVE_BOT_POLICY)
  );
  const candidatePolicy = options.candidatePolicy ?? CANDIDATE_V8;
  const baselinePolicy = options.baselinePolicy ?? LIVE_BOT_POLICY;
  const secondLeg = firstLeg.map((policy): BotPolicy =>
    policy.id === candidatePolicy.id ? baselinePolicy : candidatePolicy
  );
  const startSeed = options.startSeed ?? 1;
  const results: SelfPlayGameResult[] = [];
  const pairDifferences: number[] = [];

  for (let index = 0; index < options.pairs; index += 1) {
    const seed = startSeed + index;
    const pair = [firstLeg, secondLeg].map((policies) => runSelfPlayGame({
      playerCount: options.playerCount,
      seed,
      policies,
      maxCommands: options.maxCommandsPerGame,
    }));
    results.push(...pair);
    const participants = pair.flatMap((result) => result.participants);
    pairDifferences.push(
      winRateFor(participants, candidatePolicy.id) - winRateFor(participants, baselinePolicy.id),
    );
  }

  const participants = results.flatMap((result) => result.participants);
  const candidate = policySummary(participants, candidatePolicy.id);
  const baseline = policySummary(participants, baselinePolicy.id);
  const difference = average(pairDifferences);
  const standardError = pairDifferences.length > 1
    ? Math.sqrt(pairDifferences.reduce((sum, value) => sum + (value - difference) ** 2, 0) / (pairDifferences.length - 1)) / Math.sqrt(pairDifferences.length)
    : 0;
  const confidence95 = {
    low: Math.max(-1, difference - 1.96 * standardError),
    high: Math.min(1, difference + 1.96 * standardError),
  };
  return {
    playerCount: options.playerCount,
    pairs: options.pairs,
    games: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    stalled: results.filter((result) => result.status === "stalled").length,
    commandLimited: results.filter((result) => result.status === "commandLimit").length,
    candidate,
    baseline,
    pairedWinRateDifference: difference,
    confidence95,
    verdict: confidence95.low > 0 ? "candidate" : confidence95.high < 0 ? "baseline" : "inconclusive",
    pairDifferenceMoments: {
      count: pairDifferences.length,
      sum: pairDifferences.reduce((sum, value) => sum + value, 0),
      sumSquares: pairDifferences.reduce((sum, value) => sum + value ** 2, 0),
    },
    results,
  };
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
  policies: readonly BotPolicy[],
  commands: number,
  rejectedCommands: number,
  status: SelfPlayGameResult["status"],
  disagreements: BotDisagreement[],
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
    participants: state.seatOrder.map((id, index) => ({
      id,
      seat: index + 1,
      faction: state.players[id].faction,
      policy: policies[index]!.id,
      won: didPlayerWin(state.winner, id, state.players[id].faction),
    })),
    disagreements,
  };
}

function describeDisagreement(
  seed: number,
  commandNumber: number,
  projection: ReturnType<GameSessionService["project"]>,
  policies: readonly [BotPolicy, BotPolicy],
  decisions: readonly [BotDecision | undefined, BotDecision | undefined],
  memory: BotMemory,
): BotDisagreement {
  return {
    seed,
    commandNumber,
    actorId: projection.own.id,
    faction: projection.own.faction,
    phase: projection.phase,
    reactionKind: projection.reactionWindow?.kind,
    transmission: projection.transmission
      ? {
          method: projection.transmission.method,
          recipientId: projection.transmission.intendedRecipientId,
          faceUp: projection.transmission.faceUp,
          cardColor: projection.transmission.card?.color,
        }
      : undefined,
    intelligenceCounts: Object.fromEntries(projection.players.map((player) => {
      const counts = { red: 0, blue: 0, black: 0, physical: player.intelligence.length };
      for (const card of player.intelligence) {
        if (card.color === "红" || card.color === "红蓝") counts.red += 1;
        if (card.color === "蓝" || card.color === "红蓝") counts.blue += 1;
        if (card.color === "黑") counts.black += 1;
      }
      return [player.id, counts];
    })),
    legalActionTypes: [...new Set(projection.legalActions.map((action) => action.type))],
    policies: [policies[0].id, policies[1].id],
    decisions,
    beliefs: policies.map((policy) => factionBeliefsForPolicy(memory, projection, policy)) as [
      Record<string, FactionBelief>,
      Record<string, FactionBelief>,
    ],
    publicEvent: projection.auditLog.at(-1),
  };
}

function didPlayerWin(winner: WinnerState | undefined, playerId: string, faction: string): boolean {
  if (!winner) return false;
  return winner.kind === "agent" ? winner.playerId === playerId : winner.faction === faction;
}

function policySummary(
  participants: readonly SelfPlayGameResult["participants"][number][],
  policy: string,
): PolicyPerformanceSummary {
  const entries = participants.filter((participant) => participant.policy === policy);
  return {
    ...winRateSummary(entries),
    byFaction: groupedWinRates(entries, (entry) => entry.faction),
    bySeat: groupedWinRates(entries, (entry) => String(entry.seat)),
  };
}

function winRateSummary(
  entries: readonly SelfPlayGameResult["participants"][number][],
): WinRateSummary {
  const wins = entries.filter((participant) => participant.won).length;
  return { wins, entries: entries.length, winRate: wins / Math.max(1, entries.length) };
}

function groupedWinRates(
  entries: readonly SelfPlayGameResult["participants"][number][],
  keyFor: (entry: SelfPlayGameResult["participants"][number]) => string,
): Record<string, WinRateSummary> {
  const groups = new Map<string, SelfPlayGameResult["participants"][number][]>();
  for (const entry of entries) {
    const key = keyFor(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return Object.fromEntries([...groups].map(([key, group]) => [key, winRateSummary(group)]));
}

function winRateFor(
  participants: readonly SelfPlayGameResult["participants"][number][],
  policy: string,
): number {
  return policySummary(participants, policy).winRate;
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
