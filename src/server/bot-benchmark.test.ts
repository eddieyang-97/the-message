import { describe, expect, it } from "vitest";

import { runSelfPlayBenchmark } from "./bot-benchmark";

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
});
