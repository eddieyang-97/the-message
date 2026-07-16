import type {
  PairedTournamentResult,
  PolicyPerformanceSummary,
  WinRateSummary,
} from "./benchmark";

export interface TournamentCampaignConfig {
  playerCount: 2 | 5 | 6 | 7 | 8;
  targetPairs: number;
  startSeed: number;
  candidatePolicyId: string;
  baselinePolicyId: string;
  maxCommandsPerGame?: number;
}

export interface TournamentCampaignCheckpoint {
  version: 1;
  config: TournamentCampaignConfig;
  completedPairs: number;
  completedGames: number;
  stalledGames: number;
  commandLimitedGames: number;
  candidate: PolicyPerformanceSummary;
  baseline: PolicyPerformanceSummary;
  pairDifferenceMoments: { count: number; sum: number; sumSquares: number };
  updatedAt: string;
}

export interface TournamentCampaignSummary extends TournamentCampaignCheckpoint {
  pairedWinRateDifference: number;
  confidence95: { low: number; high: number };
  verdict: "candidate" | "baseline" | "inconclusive";
}

export function createCampaignCheckpoint(config: TournamentCampaignConfig): TournamentCampaignCheckpoint {
  if (!Number.isInteger(config.targetPairs) || config.targetPairs < 1) {
    throw new Error("targetPairs must be a positive integer");
  }
  return {
    version: 1,
    config,
    completedPairs: 0,
    completedGames: 0,
    stalledGames: 0,
    commandLimitedGames: 0,
    candidate: emptyPolicySummary(),
    baseline: emptyPolicySummary(),
    pairDifferenceMoments: { count: 0, sum: 0, sumSquares: 0 },
    updatedAt: new Date(0).toISOString(),
  };
}

export function addTournamentChunk(
  checkpoint: TournamentCampaignCheckpoint,
  chunk: PairedTournamentResult,
): TournamentCampaignCheckpoint {
  if (chunk.playerCount !== checkpoint.config.playerCount) {
    throw new Error("chunk player count does not match campaign");
  }
  if (checkpoint.completedPairs + chunk.pairs > checkpoint.config.targetPairs) {
    throw new Error("chunk exceeds campaign target");
  }
  return {
    ...checkpoint,
    completedPairs: checkpoint.completedPairs + chunk.pairs,
    completedGames: checkpoint.completedGames + chunk.completed,
    stalledGames: checkpoint.stalledGames + chunk.stalled,
    commandLimitedGames: checkpoint.commandLimitedGames + chunk.commandLimited,
    candidate: mergePolicySummaries(checkpoint.candidate, chunk.candidate),
    baseline: mergePolicySummaries(checkpoint.baseline, chunk.baseline),
    pairDifferenceMoments: {
      count: checkpoint.pairDifferenceMoments.count + chunk.pairDifferenceMoments.count,
      sum: checkpoint.pairDifferenceMoments.sum + chunk.pairDifferenceMoments.sum,
      sumSquares: checkpoint.pairDifferenceMoments.sumSquares + chunk.pairDifferenceMoments.sumSquares,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function summarizeCampaign(checkpoint: TournamentCampaignCheckpoint): TournamentCampaignSummary {
  const { count, sum, sumSquares } = checkpoint.pairDifferenceMoments;
  const difference = count ? sum / count : 0;
  const sampleVariance = count > 1
    ? Math.max(0, (sumSquares - (sum ** 2) / count) / (count - 1))
    : 0;
  const standardError = count ? Math.sqrt(sampleVariance / count) : 0;
  const confidence95 = {
    low: Math.max(-1, difference - 1.96 * standardError),
    high: Math.min(1, difference + 1.96 * standardError),
  };
  return {
    ...checkpoint,
    pairedWinRateDifference: difference,
    confidence95,
    verdict: confidence95.low > 0 ? "candidate" : confidence95.high < 0 ? "baseline" : "inconclusive",
  };
}

export function assertCampaignConfig(
  checkpoint: TournamentCampaignCheckpoint,
  expected: TournamentCampaignConfig,
): void {
  if (JSON.stringify(checkpoint.config) !== JSON.stringify(expected)) {
    throw new Error("checkpoint configuration does not match the requested campaign");
  }
  if (checkpoint.version !== 1) throw new Error(`unsupported checkpoint version: ${checkpoint.version}`);
}

function emptyPolicySummary(): PolicyPerformanceSummary {
  return { wins: 0, entries: 0, winRate: 0, byFaction: {}, bySeat: {} };
}

function mergePolicySummaries(
  left: PolicyPerformanceSummary,
  right: PolicyPerformanceSummary,
): PolicyPerformanceSummary {
  return {
    ...mergeWinRates(left, right),
    byFaction: mergeBreakdown(left.byFaction, right.byFaction),
    bySeat: mergeBreakdown(left.bySeat, right.bySeat),
  };
}

function mergeBreakdown(
  left: Record<string, WinRateSummary>,
  right: Record<string, WinRateSummary>,
): Record<string, WinRateSummary> {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return Object.fromEntries([...keys].sort().map((key) => [
    key,
    mergeWinRates(left[key] ?? emptyWinRate(), right[key] ?? emptyWinRate()),
  ]));
}

function mergeWinRates(left: WinRateSummary, right: WinRateSummary): WinRateSummary {
  const wins = left.wins + right.wins;
  const entries = left.entries + right.entries;
  return { wins, entries, winRate: entries ? wins / entries : 0 };
}

function emptyWinRate(): WinRateSummary {
  return { wins: 0, entries: 0, winRate: 0 };
}
