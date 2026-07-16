import type { BotPolicy } from "../server/bot/strategy";

export const CANDIDATE_V3: BotPolicy = {
  id: "candidate-v3",
  beliefModel: "exact",
  scoring: "tactical",
  burnBase: 7,
  reactionConservation: 0,
};

export const CANDIDATE_V4: BotPolicy = {
  ...CANDIDATE_V3,
  id: "candidate-v4",
  burnBase: 4,
};

export const CANDIDATE_V5: BotPolicy = {
  ...CANDIDATE_V4,
  id: "candidate-v5",
  reactionConservation: 1.5,
};

export const CANDIDATE_V6: BotPolicy = {
  ...CANDIDATE_V5,
  id: "candidate-v6",
  reactionConservation: 0.75,
};
