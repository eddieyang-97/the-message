import { describe, expect, it } from "vitest";

import { runPairedTournament, runSelfPlayBenchmark, runSelfPlayGame } from "./benchmark";
import { CANDIDATE_V7, CANDIDATE_V8 } from "./policies";
import { LIVE_BOT_POLICY, TACTICAL_V2 } from "../server/bot/strategy";

describe("AI self-play benchmark", () => {
  it("finishes deterministic duel batches without stalling", () => {
    const first = runSelfPlayBenchmark({ playerCount: 2, games: 5, startSeed: 1 });
    const second = runSelfPlayBenchmark({ playerCount: 2, games: 5, startSeed: 1 });

    expect(first.results).toEqual(second.results);
    expect(first.completed).toBe(5);
    expect(first.stalled).toBe(0);
    expect(first.commandLimited).toBe(0);
    expect(first.rejectedCommands).toBeGreaterThan(0);
  });

  it("compares baseline and candidate in deterministic swapped-seat pairs", () => {
    const first = runPairedTournament({ playerCount: 2, pairs: 5, startSeed: 21 });
    const second = runPairedTournament({ playerCount: 2, pairs: 5, startSeed: 21 });

    expect(first).toEqual(second);
    expect(first.games).toBe(10);
    expect(first.completed).toBe(10);
    expect(first.stalled).toBe(0);
    expect(first.candidate.entries).toBe(10);
    expect(first.baseline.entries).toBe(10);
    expect(first.confidence95.low).toBeLessThanOrEqual(first.pairedWinRateDifference);
    expect(first.confidence95.high).toBeGreaterThanOrEqual(first.pairedWinRateDifference);
    for (let index = 0; index < first.results.length; index += 2) {
      const firstLeg = first.results[index]!;
      const secondLeg = first.results[index + 1]!;
      expect(firstLeg.seed).toBe(secondLeg.seed);
      expect(firstLeg.participants.map((entry) => entry.faction)).toEqual(
        secondLeg.participants.map((entry) => entry.faction),
      );
      expect(firstLeg.participants.map((entry) => entry.policy)).toEqual(
        secondLeg.participants.map((entry) =>
          entry.policy === CANDIDATE_V8.id ? LIVE_BOT_POLICY.id : CANDIDATE_V8.id
        ),
      );
    }
  });

  it("records policy disagreements without changing tactical-v2 game outcomes", () => {
    const ordinary = runSelfPlayBenchmark({ playerCount: 5, games: 1, startSeed: 101 });
    const observed = runSelfPlayGame({
      playerCount: 5,
      seed: 101,
      comparePolicies: [TACTICAL_V2, CANDIDATE_V7],
    });

    expect(observed.winner).toEqual(ordinary.results[0]?.winner);
    expect(observed.commands).toBe(ordinary.results[0]?.commands);
    expect(observed.disagreements.length).toBeGreaterThan(0);
    expect(observed.disagreements[0]).toMatchObject({
      seed: 101,
      policies: [TACTICAL_V2.id, CANDIDATE_V7.id],
    });
    expect(observed.disagreements.every((entry) =>
      JSON.stringify(entry.decisions[0]?.command) !== JSON.stringify(entry.decisions[1]?.command)
    )).toBe(true);
  });
});
