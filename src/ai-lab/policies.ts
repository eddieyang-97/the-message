import { TACTICAL_V2, TACTICAL_V3, type BotPolicy } from "../server/bot/strategy";

export const CANDIDATE_V3: BotPolicy = {
  id: "candidate-v3",
  beliefModel: "exact",
  scoring: "tactical",
  burnBase: 7,
  reactionConservation: 0,
  incrementalTransfer: false,
  incrementalLure: false,
};

export const CANDIDATE_V4: BotPolicy = {
  ...CANDIDATE_V3,
  id: "candidate-v4",
  burnBase: 4,
};

export const CANDIDATE_V5: BotPolicy = {
  ...TACTICAL_V3,
  id: "candidate-v5",
};

export const CANDIDATE_V6: BotPolicy = {
  ...CANDIDATE_V5,
  id: "candidate-v6",
  reactionConservation: 0.75,
};

export const CANDIDATE_V7: BotPolicy = {
  ...CANDIDATE_V5,
  id: "candidate-v7",
  incrementalTransfer: true,
};

export const CANDIDATE_V8: BotPolicy = {
  ...CANDIDATE_V5,
  id: "candidate-v8",
  incrementalLure: true,
};

export const EVALUATION_POLICIES: readonly BotPolicy[] = [
  TACTICAL_V2,
  TACTICAL_V3,
  CANDIDATE_V3,
  CANDIDATE_V4,
  CANDIDATE_V5,
  CANDIDATE_V6,
  CANDIDATE_V7,
  CANDIDATE_V8,
];

export function evaluationPolicyById(id: string): BotPolicy {
  const policy = EVALUATION_POLICIES.find((candidate) => candidate.id === id);
  if (!policy) {
    throw new Error(`unknown policy '${id}'; choose one of: ${EVALUATION_POLICIES.map((item) => item.id).join(", ")}`);
  }
  return policy;
}
