import { runSelfPlayBenchmark } from "./bot-benchmark";

const playerCount = parseInteger(process.argv[2] ?? "2", "player count") as 2 | 5 | 6 | 7 | 8;
const games = parseInteger(process.argv[3] ?? "100", "game count");
const startSeed = parseInteger(process.argv[4] ?? "1", "start seed");
const result = runSelfPlayBenchmark({ playerCount, games, startSeed });

console.log(`AI self-play: ${result.games} games, ${result.playerCount} players`);
console.log(`completed=${result.completed} stalled=${result.stalled} commandLimit=${result.commandLimited}`);
console.log(`avgCommands=${result.averageCommands.toFixed(1)} avgTurns=${result.averageTurns.toFixed(1)} rejected=${result.rejectedCommands}`);
console.log(`winners=${JSON.stringify(result.winners)}`);

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}
