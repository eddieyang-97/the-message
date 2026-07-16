import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runPairedTournament } from "./benchmark";
import {
  addTournamentChunk,
  assertCampaignConfig,
  createCampaignCheckpoint,
  summarizeCampaign,
  type TournamentCampaignCheckpoint,
  type TournamentCampaignConfig,
} from "./campaign";
import { CANDIDATE_V6, evaluationPolicyById } from "./policies";
import { LIVE_BOT_POLICY } from "../server/bot/strategy";

const parsed = parseArguments(process.argv.slice(2));
const playerCount = parseInteger(parsed.positional[0] ?? "5", "player count") as 2 | 5 | 6 | 7 | 8;
const targetPairs = parseInteger(parsed.positional[1] ?? "1000", "pair count");
const startSeed = parseInteger(parsed.positional[2] ?? "1", "start seed");
const candidate = evaluationPolicyById(parsed.options.candidate ?? CANDIDATE_V6.id);
const baseline = evaluationPolicyById(parsed.options.baseline ?? LIVE_BOT_POLICY.id);
if (candidate.id === baseline.id) throw new Error("candidate and baseline policies must differ");
const chunkSize = parseInteger(parsed.options["chunk-size"] ?? String(Math.min(100, targetPairs)), "chunk size");
const checkpointPath = parsed.options.checkpoint ? resolve(parsed.options.checkpoint) : undefined;
const config: TournamentCampaignConfig = {
  playerCount,
  targetPairs,
  startSeed,
  candidatePolicyId: candidate.id,
  baselinePolicyId: baseline.id,
};
let checkpoint = loadOrCreateCheckpoint(config, checkpointPath, parsed.flags.has("resume"));
const startedAt = Date.now();

while (checkpoint.completedPairs < config.targetPairs) {
  const pairs = Math.min(chunkSize, config.targetPairs - checkpoint.completedPairs);
  const chunk = runPairedTournament({
    playerCount,
    pairs,
    startSeed: startSeed + checkpoint.completedPairs,
    candidatePolicy: candidate,
    baselinePolicy: baseline,
  });
  checkpoint = addTournamentChunk(checkpoint, chunk);
  if (checkpointPath) writeCheckpoint(checkpointPath, checkpoint);
  const partial = summarizeCampaign(checkpoint);
  console.log(
    `progress=${checkpoint.completedPairs}/${config.targetPairs} pairs `
    + `difference=${percent(partial.pairedWinRateDifference)} `
    + `elapsed=${formatDuration(Date.now() - startedAt)}`,
  );
}

const result = summarizeCampaign(checkpoint);
console.log(`AI A/B: ${result.completedPairs} pairs (${result.completedPairs * 2} games), ${result.config.playerCount} players`);
console.log(`policies=${result.config.candidatePolicyId} vs ${result.config.baselinePolicyId}`);
console.log(`completed=${result.completedGames} stalled=${result.stalledGames} commandLimit=${result.commandLimitedGames}`);
console.log(`candidate=${formatWinRate(result.candidate)} baseline=${formatWinRate(result.baseline)}`);
console.log(`paired difference=${percent(result.pairedWinRateDifference)} 95% CI=[${percent(result.confidence95.low)}, ${percent(result.confidence95.high)}] verdict=${result.verdict}`);
console.log(`candidate by faction=${formatBreakdown(result.candidate.byFaction)}`);
console.log(`baseline by faction=${formatBreakdown(result.baseline.byFaction)}`);
console.log(`candidate by seat=${formatBreakdown(result.candidate.bySeat)}`);
console.log(`baseline by seat=${formatBreakdown(result.baseline.bySeat)}`);
if (checkpointPath) console.log(`checkpoint=${checkpointPath}`);

function loadOrCreateCheckpoint(
  expectedConfig: TournamentCampaignConfig,
  path: string | undefined,
  resume: boolean,
): TournamentCampaignCheckpoint {
  if (resume) {
    if (!path) throw new Error("--resume requires --checkpoint <path>");
    if (!existsSync(path)) throw new Error(`checkpoint does not exist: ${path}`);
    const saved = JSON.parse(readFileSync(path, "utf8")) as TournamentCampaignCheckpoint;
    assertCampaignConfig(saved, expectedConfig);
    return saved;
  }
  if (path && existsSync(path)) {
    throw new Error(`checkpoint already exists; pass --resume or choose another path: ${path}`);
  }
  return createCampaignCheckpoint(expectedConfig);
}

function writeCheckpoint(path: string, value: TournamentCampaignCheckpoint): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, path);
}

function formatBreakdown(values: Record<string, { wins: number; entries: number; winRate: number }>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, formatWinRate(value)])));
}

function formatWinRate(value: { wins: number; entries: number; winRate: number }): string {
  return `${value.wins}/${value.entries} (${percent(value.winRate)})`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseArguments(args: string[]): {
  positional: string[];
  options: Record<string, string>;
  flags: Set<string>;
} {
  const positional: string[] = [];
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === "resume") {
      flags.add(key);
      continue;
    }
    const optionValue = args[index + 1];
    if (!optionValue || optionValue.startsWith("--")) throw new Error(`${value} requires a value`);
    options[key] = optionValue;
    index += 1;
  }
  return { positional, options, flags };
}
