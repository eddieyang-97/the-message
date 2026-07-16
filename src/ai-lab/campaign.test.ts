import { describe, expect, it } from "vitest";

import { runPairedTournament } from "./benchmark";
import {
  addTournamentChunk,
  assertCampaignConfig,
  createCampaignCheckpoint,
  summarizeCampaign,
  type TournamentCampaignConfig,
} from "./campaign";
import { CANDIDATE_V5 } from "./policies";
import { TACTICAL_V2 } from "../server/bot/strategy";

describe("AI tournament campaigns", () => {
  const config: TournamentCampaignConfig = {
    playerCount: 2,
    targetPairs: 4,
    startSeed: 31,
    candidatePolicyId: CANDIDATE_V5.id,
    baselinePolicyId: TACTICAL_V2.id,
  };

  it("merges resumable chunks into the same aggregate as a single run", () => {
    const whole = runPairedTournament({
      playerCount: 2,
      pairs: 4,
      startSeed: 31,
      candidatePolicy: CANDIDATE_V5,
      baselinePolicy: TACTICAL_V2,
    });
    const firstChunk = runPairedTournament({
      playerCount: 2,
      pairs: 2,
      startSeed: 31,
      candidatePolicy: CANDIDATE_V5,
      baselinePolicy: TACTICAL_V2,
    });
    const secondChunk = runPairedTournament({
      playerCount: 2,
      pairs: 2,
      startSeed: 33,
      candidatePolicy: CANDIDATE_V5,
      baselinePolicy: TACTICAL_V2,
    });
    const resumed = addTournamentChunk(addTournamentChunk(createCampaignCheckpoint(config), firstChunk), secondChunk);
    const summary = summarizeCampaign(resumed);

    expect(summary.completedPairs).toBe(4);
    expect(summary.completedGames).toBe(whole.completed);
    expect(summary.candidate).toEqual(whole.candidate);
    expect(summary.baseline).toEqual(whole.baseline);
    expect(summary.pairedWinRateDifference).toBeCloseTo(whole.pairedWinRateDifference, 12);
    expect(summary.confidence95.low).toBeCloseTo(whole.confidence95.low, 12);
    expect(summary.confidence95.high).toBeCloseTo(whole.confidence95.high, 12);
  });

  it("provides faction and seat breakdowns and rejects mismatched resumes", () => {
    const chunk = runPairedTournament({
      playerCount: 2,
      pairs: 1,
      startSeed: 31,
      candidatePolicy: CANDIDATE_V5,
      baselinePolicy: TACTICAL_V2,
    });
    const checkpoint = addTournamentChunk(createCampaignCheckpoint(config), chunk);

    expect(Object.keys(checkpoint.candidate.byFaction).length).toBeGreaterThan(0);
    expect(checkpoint.candidate.bySeat).toEqual(expect.objectContaining({ "1": expect.any(Object), "2": expect.any(Object) }));
    expect(() => assertCampaignConfig(checkpoint, { ...config, startSeed: 32 })).toThrow(/does not match/);
  });
});
