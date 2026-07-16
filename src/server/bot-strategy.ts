import type { Faction, PhysicalCard, PhysicalCardId, SingleColor } from "../game/cards";
import { factionsForPlayerCount, type ActiveFunctionKind, type PlayerProjection } from "../game/engine";
import type { GameCommand } from "./game-session";

const FACTIONS = ["军情", "潜伏", "特工"] as const satisfies readonly Faction[];

export type BotRandom = () => number;
export type LegalAction = PlayerProjection["legalActions"][number];
export type BotPolicyId = "baseline-v1" | "tactical-v2" | "candidate-v3" | "candidate-v4";

interface PublicObservation {
  auditLength: number;
  transmission?: {
    signature: string;
    senderId: string;
    targetId: string;
    card?: PhysicalCard;
  };
  functionAction?: {
    signature: string;
    kind: ActiveFunctionKind;
    sourceId: string;
    targetId: string;
  };
  players: Record<string, {
    alive: boolean;
    faction?: Faction;
    intelligence: PhysicalCard[];
  }>;
}

export interface FactionBelief {
  军情: number;
  潜伏: number;
  特工: number;
}

export interface BotMemory {
  readonly botId: string;
  /** Additive evidence, retained between decisions. It contains no hidden state. */
  evidence: Record<string, FactionBelief>;
  previous?: PublicObservation;
}

export interface BotDecision {
  command: GameCommand;
  score: number;
  reason: string;
}

export interface BotDecisionOptions {
  /** Versioned decision policy. Live bots default to the current candidate. */
  policy?: BotPolicyId;
  /** Inject a seeded generator for reproducible games. Defaults to deterministic ordering. */
  random?: BotRandom;
  /** Commands rejected against the unchanged authoritative state. */
  excludedCommands?: readonly GameCommand[];
  excludedTransmissionCardIds?: readonly PhysicalCardId[];
}

interface IntelligenceCounts {
  red: number;
  blue: number;
  black: number;
  physical: number;
}

export function createSeededBotRandom(seed: number): BotRandom {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function createBotMemory(projection: PlayerProjection): BotMemory {
  const memory: BotMemory = {
    botId: projection.own.id,
    evidence: {},
  };
  observeBotProjection(memory, projection);
  return memory;
}

/**
 * Updates private bot beliefs from public board changes and explicitly revealed
 * factions. It deliberately does not inspect engine state or other hands.
 */
export function observeBotProjection(memory: BotMemory, projection: PlayerProjection): void {
  if (memory.botId !== projection.own.id) {
    throw new Error("Bot memory cannot observe another player's private projection");
  }

  for (const player of projection.players) {
    const evidence = memory.evidence[player.id] ??= emptyBelief();
    const previous = memory.previous?.players[player.id];
    if (player.faction) {
      evidence.军情 = player.faction === "军情" ? 100 : -100;
      evidence.潜伏 = player.faction === "潜伏" ? 100 : -100;
      evidence.特工 = player.faction === "特工" ? 100 : -100;
      continue;
    }

    if (previous) {
      const knownIds = new Set(previous.intelligence.map((card) => card.id));
      for (const card of player.intelligence) {
        if (knownIds.has(card.id)) continue;
        // Receipt is useful evidence, but deliberately weak: receipt may have
        // been locked, intercepted, transferred, or forced.
        if (card.color === "蓝") evidence.军情 += 0.8;
        else if (card.color === "红") evidence.潜伏 += 0.8;
        else if (card.color === "红蓝") {
          evidence.军情 += 0.45;
          evidence.潜伏 += 0.45;
        } else {
          evidence.特工 += 0.2;
        }
      }
    }
  }

  const priorTransmission = memory.previous?.transmission;
  const currentTransmission = transmissionObservation(projection);
  if (currentTransmission && currentTransmission.signature !== priorTransmission?.signature) {
    const target = projection.players.find((player) => player.id === currentTransmission.targetId);
    const senderEvidence = memory.evidence[currentTransmission.senderId] ??= emptyBelief();
    if (target?.faction && currentTransmission.card) {
      const helpful = cardHelpsFaction(currentTransmission.card, target.faction);
      senderEvidence[target.faction] += helpful ? 0.65 : -0.35;
      if (!helpful) {
        for (const faction of FACTIONS) if (faction !== target.faction) senderEvidence[faction] += 0.15;
      }
    }
  }

  const priorFunction = memory.previous?.functionAction;
  const currentFunction = functionObservation(projection);
  if (currentFunction && currentFunction.signature !== priorFunction?.signature) {
    const target = projection.players.find((player) => player.id === currentFunction.targetId);
    const sourceEvidence = memory.evidence[currentFunction.sourceId] ??= emptyBelief();
    if (target?.faction) {
      if (currentFunction.kind === "publicText") sourceEvidence[target.faction] += 0.35;
      if (currentFunction.kind === "dangerousIntelligence") {
        sourceEvidence[target.faction] -= 0.45;
        for (const faction of FACTIONS) if (faction !== target.faction) sourceEvidence[faction] += 0.2;
      }
    }
  }

  memory.previous = snapshot(projection);
}

export function factionBeliefs(memory: BotMemory, projection: PlayerProjection): Record<string, FactionBelief> {
  const result: Record<string, FactionBelief> = {};
  const known = new Map<string, Faction>();
  for (const player of projection.players) {
    if (player.faction) known.set(player.id, player.faction);
    else if (player.id === projection.own.id) known.set(player.id, projection.own.faction);
  }
  for (const [playerId, faction] of known) result[playerId] = oneHot(faction);

  const distribution = factionsForPlayerCount(projection.players.length);
  const totals = Object.fromEntries(FACTIONS.map((faction) => [
    faction,
    distribution.filter((entry) => entry === faction).length,
  ])) as Record<Faction, number>;
  const remaining = { ...totals };
  for (const faction of known.values()) remaining[faction] -= 1;
  const hiddenIds = projection.players.filter((player) => !known.has(player.id)).map((player) => player.id);
  const weightedAssignments: Array<{ assignment: Record<string, Faction>; logWeight: number }> = [];

  enumerateFactionAssignments(hiddenIds, 0, remaining, {}, memory, weightedAssignments);
  if (weightedAssignments.length === 0) {
    throw new Error("Known factions are inconsistent with the player-count distribution");
  }
  const maxLogWeight = Math.max(...weightedAssignments.map((entry) => entry.logWeight));
  const normalizer = weightedAssignments.reduce(
    (sum, entry) => sum + Math.exp(entry.logWeight - maxLogWeight),
    0,
  );
  for (const playerId of hiddenIds) {
    const belief = emptyBelief();
    for (const entry of weightedAssignments) {
      belief[entry.assignment[playerId]!] += Math.exp(entry.logWeight - maxLogWeight) / normalizer;
    }
    result[playerId] = belief;
  }
  return result;
}

export function factionBeliefsForPolicy(
  memory: BotMemory,
  projection: PlayerProjection,
  policy: BotPolicyId,
): Record<string, FactionBelief> {
  return policy === "candidate-v3" || policy === "candidate-v4"
    ? factionBeliefs(memory, projection)
    : independentFactionBeliefs(memory, projection);
}

function independentFactionBeliefs(memory: BotMemory, projection: PlayerProjection): Record<string, FactionBelief> {
  const distribution = factionsForPlayerCount(projection.players.length);
  const totals = Object.fromEntries(FACTIONS.map((faction) => [faction, distribution.filter((entry) => entry === faction).length])) as Record<Faction, number>;
  const revealed = Object.fromEntries(FACTIONS.map((faction) => [faction, projection.players.filter((player) => player.faction === faction || (player.id === projection.own.id && projection.own.faction === faction && !player.faction)).length])) as Record<Faction, number>;
  const hiddenCount = projection.players.filter((player) => !player.faction && player.id !== projection.own.id).length;
  const result: Record<string, FactionBelief> = {};
  for (const player of projection.players) {
    if (player.faction) {
      result[player.id] = oneHot(player.faction);
      continue;
    }
    if (player.id === projection.own.id) {
      result[player.id] = oneHot(projection.own.faction);
      continue;
    }
    const evidence = memory.evidence[player.id] ?? emptyBelief();
    const weighted = Object.fromEntries(FACTIONS.map((faction) => {
      const prior = Math.max(0, (totals[faction] - revealed[faction]) / Math.max(1, hiddenCount));
      return [faction, prior * Math.exp(Math.max(-8, Math.min(8, evidence[faction])))];
    })) as unknown as FactionBelief;
    const sum = FACTIONS.reduce((total, faction) => total + weighted[faction], 0);
    result[player.id] = Object.fromEntries(
      FACTIONS.map((faction) => [faction, sum > 0 ? weighted[faction] / sum : 1 / FACTIONS.length]),
    ) as unknown as FactionBelief;
  }
  return result;
}

function enumerateFactionAssignments(
  playerIds: readonly string[],
  index: number,
  remaining: Record<Faction, number>,
  assignment: Record<string, Faction>,
  memory: BotMemory,
  output: Array<{ assignment: Record<string, Faction>; logWeight: number }>,
): void {
  if (index === playerIds.length) {
    if (FACTIONS.some((faction) => remaining[faction] !== 0)) return;
    const logWeight = playerIds.reduce((sum, playerId) => {
      const evidence = memory.evidence[playerId] ?? emptyBelief();
      return sum + Math.max(-8, Math.min(8, evidence[assignment[playerId]!]));
    }, 0);
    output.push({ assignment: { ...assignment }, logWeight });
    return;
  }
  const playerId = playerIds[index]!;
  for (const faction of FACTIONS) {
    if (remaining[faction] <= 0) continue;
    assignment[playerId] = faction;
    remaining[faction] -= 1;
    enumerateFactionAssignments(playerIds, index + 1, remaining, assignment, memory, output);
    remaining[faction] += 1;
    delete assignment[playerId];
  }
}

export function chooseBotCommand(
  projection: PlayerProjection,
  memory: BotMemory,
  options: BotDecisionOptions = {},
): GameCommand | undefined {
  return chooseBotDecision(projection, memory, options)?.command;
}

export function chooseBotDecision(
  projection: PlayerProjection,
  memory: BotMemory,
  options: BotDecisionOptions = {},
): BotDecision | undefined {
  observeBotProjection(memory, projection);
  if (projection.winner || !projection.players.find((player) => player.id === memory.botId)?.alive) {
    return undefined;
  }
  const policy = options.policy ?? "tactical-v2";
  const beliefs = factionBeliefsForPolicy(memory, projection, policy);
  const excluded = new Set(
    options.excludedCommands?.map((command) => JSON.stringify(command)) ?? [],
  );
  const candidates = projection.legalActions
    .map((action) => policy === "baseline-v1"
      ? scoreBaselineAction(action, projection, beliefs)
      : scoreAction(action, projection, beliefs, policy))
    .filter((candidate) => !excluded.has(JSON.stringify(candidate.command)));

  if (candidates.length === 0) {
    const transmission = synthesizeTransmission(
      projection,
      beliefs,
      options.random,
      excluded,
      new Set(options.excludedTransmissionCardIds ?? []),
      policy,
    );
    return transmission ? { command: transmission, score: 25, reason: "start required transmission" } : undefined;
  }
  const highest = Math.max(...candidates.map((candidate) => candidate.score));
  const tied = candidates.filter((candidate) => Math.abs(candidate.score - highest) < 0.0001);
  return tied[pickIndex(tied.length, options.random)];
}

/** Frozen pre-tactical policy retained for paired A/B evaluation. */
function scoreBaselineAction(
  action: LegalAction,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): BotDecision {
  const command = action as GameCommand;
  const ownFaction = projection.own.faction;
  const card = "cardId" in action ? projection.own.hand.find((item) => item.id === action.cardId) : undefined;
  switch (action.type) {
    case "ACCEPT_INTELLIGENCE":
      return decision(command, intelligenceValue(projection.transmission?.card, ownFaction, ownBlackCount(projection)), "baseline receipt evaluation");
    case "DECLINE_INTELLIGENCE": return decision(command, 2, "baseline decline");
    case "ENTER_TRANSMISSION_PHASE": return decision(command, 10, "baseline enter transmission");
    case "PASS_LOCK": return decision(command, 4, "baseline preserve lock");
    case "PLAY_LOCK": return decision(command, Math.max(3, intelligenceValue(projection.transmission?.card, ownFaction, ownBlackCount(projection)) + 12), "baseline lock");
    case "PASS_REACTION": return decision(command, 5, "baseline preserve reaction");
    case "PLAY_COUNTER": return decision(command, 18, "baseline always counter");
    case "PLAY_DECRYPT": return decision(command, projection.transmission?.card ? 4 : 14, "baseline decrypt");
    case "PLAY_INTERCEPT": return decision(command, intelligenceValue(projection.transmission?.card, ownFaction, ownBlackCount(projection)) + 5, "baseline intercept");
    case "PLAY_SWAP": return decision(command, projection.transmission?.card && intelligenceValue(projection.transmission.card, ownFaction, ownBlackCount(projection)) < 0 ? 16 : 7, "baseline swap");
    case "PLAY_TRANSFER":
    case "PLAY_SEPARATION":
    case "PLAY_FUNCTION_SEPARATION":
      return decision(command, targetAffinity(action.targetId, ownFaction, beliefs) * 8 + 8, "baseline ally redirect");
    case "PLAY_BURN": return decision(command, targetAffinity(action.targetPlayerId, ownFaction, beliefs) * 12 + 8, "baseline ally burn");
    case "PLAY_PUBLIC_TEXT": return decision(command, targetAffinity(action.targetId, ownFaction, beliefs) * 5 + 8, "baseline public text");
    case "PLAY_DANGEROUS_INTELLIGENCE": return decision(command, -targetAffinity(action.targetId, ownFaction, beliefs) * 8 + 10, "baseline dangerous intelligence");
    case "PLAY_PROBE": return decision(command, informationUncertainty(action.targetId, beliefs) * 8 + 8, "baseline probe");
    case "PLAY_REINFORCEMENT": return decision(command, 17, "baseline reinforcement");
    case "PLAY_CONFIDENTIAL_FILE": return decision(command, 22, "baseline confidential file");
    case "PLAY_LURE": return decision(command, 11, "baseline lure");
    case "CHOOSE_PROBE_IDENTITY": return decision(command, action.choice === "giveRandom" && projection.own.hand.length > 2 ? 9 : 7, "baseline probe choice");
    case "CHOOSE_PUBLIC_TEXT_EFFECT": return decision(command, action.choice === "drawTwo" ? 20 : action.choice === "drawOne" ? 13 : 4, "baseline public text choice");
    case "PLAY_SECRET_ORDER": return decision(command, 12, "baseline secret order");
    case "CLAIM_NO_SECRET_ORDER_MATCH": return decision(command, 100, "baseline required claim");
    case "DISCARD_FOR_HAND_LIMIT":
    case "CHOOSE_DANGEROUS_DISCARD":
    case "CHOOSE_PROBE_DISCARD":
    case "CHOOSE_PUBLIC_TEXT_DISCARD":
      return decision(command, -cardUtility(card, ownFaction), "baseline discard");
  }
}

function scoreAction(
  action: LegalAction,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
  policy: BotPolicyId,
): BotDecision {
  const command = action as GameCommand;
  const ownFaction = projection.own.faction;
  const card = "cardId" in action ? projection.own.hand.find((item) => item.id === action.cardId) : undefined;
  switch (action.type) {
    case "ACCEPT_INTELLIGENCE":
      return decision(command, 5 + receiptUtility(projection.transmission?.card, projection.own.id, projection, beliefs), "evaluate tactical receipt outcome");
    case "DECLINE_INTELLIGENCE":
      return decision(command, 5, "preserve the current board state");
    case "ENTER_TRANSMISSION_PHASE":
      return decision(command, 10, "finish function-card phase");
    case "PASS_LOCK":
      return decision(command, 4, "preserve lock card");
    case "PLAY_LOCK":
      return decision(command, 6 + receiptUtility(projection.transmission?.card, projection.transmission?.intendedRecipientId, projection, beliefs), "secure a tactically valuable receipt");
    case "PASS_REACTION":
      return decision(command, 5, "preserve reaction cards");
    case "PLAY_COUNTER":
      return decision(command, 5 - pendingInteractionUtility(projection, beliefs), "counter only when the pending action is unfavorable");
    case "PLAY_DECRYPT":
      return decision(command, projection.transmission?.card ? 4 : 14, "learn hidden intelligence");
    case "PLAY_INTERCEPT":
      return decision(command, 5 + receiptUtility(projection.transmission?.card, projection.own.id, projection, beliefs), "intercept tactically useful intelligence");
    case "PLAY_SWAP":
      return decision(command, 7 + swapImprovement(card, projection, beliefs), "compare replacement and pending intelligence");
    case "PLAY_TRANSFER":
    case "PLAY_SEPARATION":
    case "PLAY_FUNCTION_SEPARATION":
      return decision(command, 7 + receiptUtility(projection.transmission?.card, action.targetId, projection, beliefs), "redirect toward the best tactical recipient");
    case "PLAY_BURN":
      return decision(
        command,
        (policy === "candidate-v4" ? 4 : 7) + burnUtility(action.targetPlayerId, projection, beliefs),
        policy === "candidate-v4"
          ? "burn only when the expected protection exceeds card-conservation cost"
          : "remove dangerous black intelligence when it helps the bot's side",
      );
    case "PLAY_PUBLIC_TEXT":
      return decision(command, targetAffinity(action.targetId, ownFaction, beliefs) * 5 + 8, "exchange with a likely ally");
    case "PLAY_DANGEROUS_INTELLIGENCE":
      return decision(command, -targetAffinity(action.targetId, ownFaction, beliefs) * 8 + 10, "pressure a likely opponent");
    case "PLAY_PROBE":
      return decision(command, informationUncertainty(action.targetId, beliefs) * 8 + 8, "probe an uncertain opponent");
    case "PLAY_REINFORCEMENT":
      return decision(command, 17, "gain cards");
    case "PLAY_CONFIDENTIAL_FILE":
      return decision(command, 22, "gain cards from developed board");
    case "PLAY_LURE":
      return decision(command, 11, "deny current recipient");
    case "CHOOSE_PROBE_IDENTITY":
      return decision(command, action.choice === "giveRandom" && projection.own.hand.length > 2 ? 9 : 7, "limit revealed identity information");
    case "CHOOSE_PUBLIC_TEXT_EFFECT":
      return decision(command, action.choice === "drawTwo" ? 20 : action.choice === "drawOne" ? 13 : 4, "maximize hand value");
    case "PLAY_SECRET_ORDER":
      return decision(command, 12, "constrain an opponent transmission");
    case "CLAIM_NO_SECRET_ORDER_MATCH":
      return decision(command, 100, "required secret-order response");
    case "DISCARD_FOR_HAND_LIMIT":
    case "CHOOSE_DANGEROUS_DISCARD":
    case "CHOOSE_PROBE_DISCARD":
    case "CHOOSE_PUBLIC_TEXT_DISCARD":
      return decision(command, -cardUtility(card, ownFaction), "discard least useful card");
  }
}

function synthesizeTransmission(
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
  random?: BotRandom,
  excluded: ReadonlySet<string> = new Set(),
  excludedCardIds: ReadonlySet<PhysicalCardId> = new Set(),
  policy: BotPolicyId = "tactical-v2",
): GameCommand | undefined {
  if (
    projection.phase !== "preTransmission" ||
    projection.activePlayerId !== projection.own.id ||
    projection.reactionWindow ||
    projection.transmission ||
    projection.pendingSecretOrder?.stage === "offering"
  ) return undefined;

  const requiredColor = projection.pendingSecretOrder?.requiredColor;
  const matchingCards = requiredColor
    ? projection.own.hand.filter((card) => matchesColor(card, requiredColor))
    : projection.own.hand;
  // A successful no-match claim (or a countered order) leaves no explicit flag
  // in PlayerProjection. The legal CLAIM action gates the pre-claim state; once
  // it is gone, an empty filtered set means the bot may transmit any card.
  const cards = matchingCards.length > 0 ? matchingCards : projection.own.hand;
  const livingTargets = projection.players.filter((player) => player.alive && player.id !== projection.own.id);
  const candidates: Array<{ command: GameCommand; score: number }> = [];
  for (const card of cards) {
    if (excludedCardIds.has(card.id as PhysicalCardId)) continue;
    const methods = card.transmission === "任意" ? (["密电", "文本", "直达"] as const) : [card.transmission];
    for (const method of methods) {
      if (method === "直达") {
        for (const target of livingTargets) {
          const helpful = transmissionCardValue(card, projection.own.faction);
          candidates.push({
            command: { type: "START_TRANSMISSION", cardId: card.id as PhysicalCardId, method, targetId: target.id },
            score: policy === "baseline-v1"
              ? helpful * targetAffinity(target.id, projection.own.faction, beliefs) - cardUtility(card, projection.own.faction) * 0.15
              : receiptUtility(card, target.id, projection, beliefs) + helpful * 0.1 - cardUtility(card, projection.own.faction) * 0.15,
          });
        }
      } else {
        const directions = card.circle && projection.mode !== "duel"
          ? (["clockwise", "counterclockwise"] as const)
          : (["clockwise"] as const);
        for (const direction of directions) {
          const recipient = adjacentLivingPlayer(projection, direction);
          candidates.push({
            command: { type: "START_TRANSMISSION", cardId: card.id as PhysicalCardId, method, direction },
            score: policy === "baseline-v1"
              ? transmissionCardValue(card, projection.own.faction) * targetAffinity(recipient, projection.own.faction, beliefs) - cardUtility(card, projection.own.faction) * 0.15
              : receiptUtility(card, recipient, projection, beliefs) - cardUtility(card, projection.own.faction) * 0.15,
          });
        }
      }
    }
  }
  const available = candidates.filter(
    (candidate) => !excluded.has(JSON.stringify(candidate.command)),
  );
  if (available.length === 0) return undefined;
  const best = Math.max(...available.map((candidate) => candidate.score));
  const tied = available.filter((candidate) => Math.abs(candidate.score - best) < 0.0001);
  return tied[pickIndex(tied.length, random)]?.command;
}

function intelligenceValue(card: PhysicalCard | undefined, faction: Faction, blackCount: number): number {
  if (!card) return 3;
  if (card.color === "黑") return blackCount >= 2 ? -100 : faction === "特工" ? 4 : -18;
  if (faction === "特工") return 15;
  const desired = faction === "军情" ? "蓝" : "红";
  return card.color === desired || card.color === "红蓝" ? 38 : -8;
}

/** Utility of adding intelligence to a recipient, including guaranteed outcomes when its face is hidden. */
export function receiptUtility(
  card: PhysicalCard | undefined,
  recipientId: string | undefined,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): number {
  if (!recipientId) return 0;
  const recipient = projection.players.find((player) => player.id === recipientId);
  if (!recipient) return 0;
  const before = countIntelligence(recipient.intelligence);
  const probabilities = recipientId === projection.own.id
    ? oneHot(projection.own.faction)
    : beliefs[recipientId] ?? { 军情: 1 / 3, 潜伏: 1 / 3, 特工: 1 / 3 };
  if (!card) {
    // A sixth physical card always wins for a 特工 unless it could also be
    // their third black. With at most one current black, even a hidden card is safe.
    if (before.physical === 5 && before.black <= 1) {
      const after = { ...before, physical: before.physical + 1 };
      return probabilities.特工 * (
        playerBoardUtility(after, "特工", recipientId, projection.own.id, projection.own.faction)
        - playerBoardUtility(before, "特工", recipientId, projection.own.id, projection.own.faction)
      );
    }
    return 0;
  }
  const after = addIntelligence(before, card);
  return FACTIONS.reduce((total, faction) => total + probabilities[faction] * (
    playerBoardUtility(after, faction, recipientId, projection.own.id, projection.own.faction)
    - playerBoardUtility(before, faction, recipientId, projection.own.id, projection.own.faction)
  ), 0);
}

/** A public-board score useful for benchmarks and future shallow search. */
export function evaluatePublicPosition(
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): number {
  if (projection.winner) {
    if (projection.winner.kind === "agent") return projection.winner.playerId === projection.own.id ? 10_000 : -10_000;
    return projection.winner.faction === projection.own.faction ? 10_000 : -10_000;
  }
  return projection.players.reduce((total, player) => {
    const probabilities = player.id === projection.own.id
      ? oneHot(projection.own.faction)
      : beliefs[player.id] ?? { 军情: 1 / 3, 潜伏: 1 / 3, 特工: 1 / 3 };
    const counts = countIntelligence(player.intelligence);
    return total + FACTIONS.reduce((value, faction) => value + probabilities[faction]
      * playerBoardUtility(counts, faction, player.id, projection.own.id, projection.own.faction), 0);
  }, projection.own.hand.reduce((total, heldCard) => total + cardUtility(heldCard, projection.own.faction) * 0.15, 0));
}

function swapImprovement(
  replacement: PhysicalCard | undefined,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): number {
  const recipient = projection.transmission?.intendedRecipientId;
  return receiptUtility(replacement, recipient, projection, beliefs)
    - receiptUtility(projection.transmission?.card, recipient, projection, beliefs);
}

function burnUtility(
  targetId: string,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): number {
  const target = projection.players.find((player) => player.id === targetId);
  if (!target) return 0;
  const before = countIntelligence(target.intelligence);
  const after = { ...before, black: Math.max(0, before.black - 1), physical: Math.max(0, before.physical - 1) };
  const probabilities = targetId === projection.own.id
    ? oneHot(projection.own.faction)
    : beliefs[targetId] ?? { 军情: 1 / 3, 潜伏: 1 / 3, 特工: 1 / 3 };
  return FACTIONS.reduce((total, faction) => total + probabilities[faction] * (
    playerBoardUtility(after, faction, targetId, projection.own.id, projection.own.faction)
    - playerBoardUtility(before, faction, targetId, projection.own.id, projection.own.faction)
  ), 0);
}

function pendingInteractionUtility(
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): number {
  const frames = projection.responseStack;
  if (frames.length === 0) return 0;
  const values = new Map<string, number>();
  for (const frame of frames) {
    let value: number;
    if (frame.kind === "counter") {
      value = -(frame.targetInteractionId ? values.get(frame.targetInteractionId) ?? 0 : 0);
    } else if (frame.kind === "intelligence") {
      value = receiptUtility(projection.transmission?.card, frame.targetPlayerId, projection, beliefs);
    } else {
      value = cardActionUtility(frame.cardName, frame.sourcePlayerId, frame.targetPlayerId, projection, beliefs);
    }
    values.set(frame.id, value);
  }
  return values.get(frames.at(-1)!.id) ?? 0;
}

function cardActionUtility(
  name: PhysicalCard["name"] | undefined,
  sourceId: string | undefined,
  targetId: string,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): number {
  const affinity = targetAffinity(targetId, projection.own.faction, beliefs);
  switch (name) {
    case "危险情报":
    case "试探":
    case "秘密下达":
      return -10 * affinity;
    case "增援":
    case "机密文件":
    case "公开文本":
    case "破译":
      return 10 * targetAffinity(sourceId ?? targetId, projection.own.faction, beliefs);
    case "烧毁":
      return burnUtility(targetId, projection, beliefs);
    case "锁定":
      return receiptUtility(projection.transmission?.card, targetId, projection, beliefs);
    case "调虎离山":
      return -receiptUtility(projection.transmission?.card, targetId, projection, beliefs);
    case "转移":
    case "离间":
      return receiptUtility(projection.transmission?.card, targetId, projection, beliefs);
    case "截获":
      return receiptUtility(projection.transmission?.card, sourceId, projection, beliefs);
    case "掉包": {
      const replacement = sourceId === projection.own.id
        ? projection.own.hand.find((held) => held.name === "掉包")
        : undefined;
      return receiptUtility(replacement, targetId, projection, beliefs)
        - receiptUtility(projection.transmission?.card, targetId, projection, beliefs);
    }
    default:
      return 0;
  }
}

function playerBoardUtility(
  counts: IntelligenceCounts,
  playerFaction: Faction,
  playerId: string,
  botId: string,
  botFaction: Faction,
): number {
  const isBot = playerId === botId;
  const aligned = botFaction !== "特工" && playerFaction === botFaction;
  const sign = isBot || aligned ? 1 : -1;
  if (counts.black >= 3) return isBot ? -10_000 : aligned ? -1_200 : 900;
  if (playerFaction === "特工" && counts.physical >= 6) return isBot ? 10_000 : -10_000;
  const desired = playerFaction === "军情" ? counts.blue : playerFaction === "潜伏" ? counts.red : counts.physical;
  if (playerFaction !== "特工" && desired >= 3) return sign * 10_000;
  const progress = playerFaction === "特工" ? desired * 16 : desired * 32;
  const blackRisk = counts.black === 2 ? 90 : counts.black * 15;
  return sign * (progress - blackRisk);
}

function countIntelligence(cards: readonly PhysicalCard[]): IntelligenceCounts {
  return cards.reduce<IntelligenceCounts>((counts, card) => {
    counts.physical += 1;
    if (card.color === "红" || card.color === "红蓝") counts.red += 1;
    if (card.color === "蓝" || card.color === "红蓝") counts.blue += 1;
    if (card.color === "黑") counts.black += 1;
    return counts;
  }, { red: 0, blue: 0, black: 0, physical: 0 });
}

function addIntelligence(counts: IntelligenceCounts, card: PhysicalCard): IntelligenceCounts {
  return countIntelligenceFromBase(counts, [card]);
}

function countIntelligenceFromBase(base: IntelligenceCounts, cards: readonly PhysicalCard[]): IntelligenceCounts {
  const added = countIntelligence(cards);
  return {
    red: base.red + added.red,
    blue: base.blue + added.blue,
    black: base.black + added.black,
    physical: base.physical + added.physical,
  };
}

function transmissionCardValue(card: PhysicalCard, faction: Faction): number {
  return intelligenceValue(card, faction, 0);
}

function cardUtility(card: PhysicalCard | undefined, faction: Faction): number {
  if (!card) return 0;
  const actionValue: Partial<Record<PhysicalCard["name"], number>> = {
    识破: 14, 转移: 12, 截获: 12, 掉包: 11, 锁定: 10, 烧毁: 10,
    增援: 9, 破译: 8, 调虎离山: 8, 离间: 8, 机密文件: 7,
  };
  return (actionValue[card.name] ?? 5) + Math.max(0, transmissionCardValue(card, faction) * 0.15);
}

function targetAffinity(playerId: string | undefined, faction: Faction, beliefs: Record<string, FactionBelief>): number {
  if (!playerId) return 0;
  const belief = beliefs[playerId];
  if (!belief) return 0;
  return belief[faction] - Math.max(...FACTIONS.filter((entry) => entry !== faction).map((entry) => belief[entry]));
}

function informationUncertainty(playerId: string, beliefs: Record<string, FactionBelief>): number {
  const belief = beliefs[playerId];
  return belief ? 1 - Math.max(...FACTIONS.map((faction) => belief[faction])) : 1;
}

function ownBlackCount(projection: PlayerProjection): number {
  return projection.players.find((player) => player.id === projection.own.id)?.intelligence.filter((card) => card.color === "黑").length ?? 0;
}

function adjacentLivingPlayer(projection: PlayerProjection, direction: "clockwise" | "counterclockwise"): string {
  const order = direction === "clockwise" ? projection.seatOrder : [...projection.seatOrder].reverse();
  const ownIndex = order.indexOf(projection.own.id);
  for (let offset = 1; offset < order.length; offset += 1) {
    const id = order[(ownIndex + offset) % order.length]!;
    if (projection.players.find((player) => player.id === id)?.alive) return id;
  }
  throw new Error("Cannot transmit without another living player");
}

function matchesColor(card: PhysicalCard, color: SingleColor): boolean {
  return card.color === color || (card.color === "红蓝" && color !== "黑");
}

function decision(command: GameCommand, score: number, reason: string): BotDecision {
  return { command, score, reason };
}

function pickIndex(length: number, random?: BotRandom): number {
  if (length <= 1 || !random) return 0;
  return Math.min(length - 1, Math.floor(random() * length));
}

function snapshot(projection: PlayerProjection): PublicObservation {
  return {
    auditLength: projection.auditLog.length,
    transmission: transmissionObservation(projection),
    functionAction: functionObservation(projection),
    players: Object.fromEntries(projection.players.map((player) => [player.id, {
      alive: player.alive,
      faction: player.faction,
      intelligence: [...player.intelligence],
    }])),
  };
}

function transmissionObservation(projection: PlayerProjection): PublicObservation["transmission"] {
  const current = projection.transmission;
  if (!current) return undefined;
  return {
    signature: [current.senderId, current.card?.id ?? "hidden"].join("|"),
    senderId: current.senderId,
    targetId: current.intendedRecipientId,
    card: current.card,
  };
}

function functionObservation(projection: PlayerProjection): PublicObservation["functionAction"] {
  const current = projection.activeFunctionAction;
  if (!current) return undefined;
  return {
    signature: [current.kind, current.sourcePlayerId].join("|"),
    kind: current.kind,
    sourceId: current.sourcePlayerId,
    targetId: current.targetPlayerId,
  };
}

function cardHelpsFaction(card: PhysicalCard, faction: Faction): boolean {
  if (faction === "特工") return card.color !== "黑";
  const desired = faction === "军情" ? "蓝" : "红";
  return card.color === desired || card.color === "红蓝";
}

function emptyBelief(): FactionBelief {
  return { 军情: 0, 潜伏: 0, 特工: 0 };
}

function oneHot(faction: Faction): FactionBelief {
  return { 军情: faction === "军情" ? 1 : 0, 潜伏: faction === "潜伏" ? 1 : 0, 特工: faction === "特工" ? 1 : 0 };
}
