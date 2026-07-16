import { runPairedTournament, runSelfPlayBenchmark, runSelfPlayGame } from "./benchmark";
import { CANDIDATE_V6 } from "./policies";
import { TACTICAL_V2 } from "../server/bot/strategy";

const mode = process.argv[2] === "ab"
  ? "ab"
  : process.argv[2] === "disagreements"
    ? "disagreements"
    : "self-play";
const offset = mode === "self-play" ? 0 : 1;
const playerCount = parseInteger(process.argv[2 + offset] ?? "2", "player count") as 2 | 5 | 6 | 7 | 8;
const games = parseInteger(process.argv[3 + offset] ?? "100", mode === "ab" ? "pair count" : "game count");
const startSeed = parseInteger(process.argv[4 + offset] ?? "1", "start seed");

if (mode === "ab") {
  const result = runPairedTournament({
    playerCount,
    pairs: games,
    startSeed,
    candidatePolicy: CANDIDATE_V6,
  });
  console.log(`AI A/B: ${result.pairs} pairs (${result.games} games), ${result.playerCount} players`);
  console.log(`completed=${result.completed} stalled=${result.stalled} commandLimit=${result.commandLimited}`);
  console.log(`candidate=${result.candidate.wins}/${result.candidate.entries} (${percent(result.candidate.winRate)}) baseline=${result.baseline.wins}/${result.baseline.entries} (${percent(result.baseline.winRate)})`);
  console.log(`paired difference=${percent(result.pairedWinRateDifference)} 95% CI=[${percent(result.confidence95.low)}, ${percent(result.confidence95.high)}] verdict=${result.verdict}`);
} else if (mode === "disagreements") {
  const results = Array.from({ length: games }, (_, index) => runSelfPlayGame({
    playerCount,
    seed: startSeed + index,
    comparePolicies: [TACTICAL_V2, CANDIDATE_V6],
  }));
  const disagreements = results.flatMap((result) => result.disagreements);
  const categoryCounts = new Map<string, number>();
  for (const entry of disagreements) {
    const category = `${entry.decisions[0]?.command.type ?? "none"} → ${entry.decisions[1]?.command.type ?? "none"}`;
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  const categories = [...categoryCounts].map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count);
  console.log(`AI disagreements: ${games} games, ${playerCount} players, ${disagreements.length} decisions`);
  console.log(`completed=${results.filter((result) => result.status === "completed").length} stalled=${results.filter((result) => result.status === "stalled").length}`);
  console.log(`categories=${JSON.stringify(categories.slice(0, 12))}`);
  for (const entry of disagreements.slice(0, 10)) {
    console.log(JSON.stringify(entry));
  }
} else {
  const result = runSelfPlayBenchmark({ playerCount, games, startSeed });

  console.log(`AI self-play: ${result.games} games, ${result.playerCount} players`);
  console.log(`completed=${result.completed} stalled=${result.stalled} commandLimit=${result.commandLimited}`);
  console.log(`avgCommands=${result.averageCommands.toFixed(1)} avgTurns=${result.averageTurns.toFixed(1)} rejected=${result.rejectedCommands}`);
  console.log(`winners=${JSON.stringify(result.winners)}`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}
