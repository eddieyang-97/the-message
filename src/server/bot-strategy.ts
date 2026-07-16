import type { Faction, PhysicalCard, PhysicalCardId, SingleColor } from "../game/cards";
import { factionsForPlayerCount, type ActiveFunctionKind, type PlayerProjection } from "../game/engine";
import type { GameCommand } from "./game-session";

const FACTIONS = ["军情", "潜伏", "特工"] as const satisfies readonly Faction[];

export type BotRandom = () => number;
export type LegalAction = PlayerProjection["legalActions"][number];

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
  /** Inject a seeded generator for reproducible games. Defaults to deterministic ordering. */
  random?: BotRandom;
  /** Commands rejected against the unchanged authoritative state. */
  excludedCommands?: readonly GameCommand[];
  excludedTransmissionCardIds?: readonly PhysicalCardId[];
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
  const distribution = factionsForPlayerCount(projection.players.length);
  const totals = Object.fromEntries(FACTIONS.map((faction) => [
    faction,
    distribution.filter((entry) => entry === faction).length,
  ])) as Record<Faction, number>;
  const revealed = Object.fromEntries(FACTIONS.map((faction) => [
    faction,
    projection.players.filter((player) =>
      player.faction === faction ||
      (player.id === projection.own.id && projection.own.faction === faction && !player.faction)
    ).length,
  ])) as Record<Faction, number>;
  const hiddenCount = projection.players.filter((player) =>
    !player.faction && player.id !== projection.own.id
  ).length;
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
  const beliefs = factionBeliefs(memory, projection);
  const excluded = new Set(
    options.excludedCommands?.map((command) => JSON.stringify(command)) ?? [],
  );
  const candidates = projection.legalActions
    .map((action) => scoreAction(action, projection, beliefs))
    .filter((candidate) => !excluded.has(JSON.stringify(candidate.command)));

  if (candidates.length === 0) {
    const transmission = synthesizeTransmission(
      projection,
      beliefs,
      options.random,
      excluded,
      new Set(options.excludedTransmissionCardIds ?? []),
    );
    return transmission ? { command: transmission, score: 25, reason: "start required transmission" } : undefined;
  }
  const highest = Math.max(...candidates.map((candidate) => candidate.score));
  const tied = candidates.filter((candidate) => Math.abs(candidate.score - highest) < 0.0001);
  return tied[pickIndex(tied.length, options.random)];
}

function scoreAction(
  action: LegalAction,
  projection: PlayerProjection,
  beliefs: Record<string, FactionBelief>,
): BotDecision {
  const command = action as GameCommand;
  const ownFaction = projection.own.faction;
  const card = "cardId" in action ? projection.own.hand.find((item) => item.id === action.cardId) : undefined;
  switch (action.type) {
    case "ACCEPT_INTELLIGENCE":
      return decision(command, intelligenceValue(projection.transmission?.card, ownFaction, ownBlackCount(projection)), "evaluate intelligence receipt");
    case "DECLINE_INTELLIGENCE":
      return decision(command, 2, "avoid an unhelpful or unknown receipt");
    case "ENTER_TRANSMISSION_PHASE":
      return decision(command, 10, "finish function-card phase");
    case "PASS_LOCK":
      return decision(command, 4, "preserve lock card");
    case "PLAY_LOCK":
      return decision(command, Math.max(3, intelligenceValue(projection.transmission?.card, ownFaction, ownBlackCount(projection)) + 12), "secure valuable transmission");
    case "PASS_REACTION":
      return decision(command, 5, "preserve reaction cards");
    case "PLAY_COUNTER":
      return decision(command, 18, "counter a hostile card action");
    case "PLAY_DECRYPT":
      return decision(command, projection.transmission?.card ? 4 : 14, "learn hidden intelligence");
    case "PLAY_INTERCEPT":
      return decision(command, intelligenceValue(projection.transmission?.card, ownFaction, ownBlackCount(projection)) + 5, "intercept useful intelligence");
    case "PLAY_SWAP":
      return decision(command, projection.transmission?.card && intelligenceValue(projection.transmission.card, ownFaction, ownBlackCount(projection)) < 0 ? 16 : 7, "replace dangerous intelligence");
    case "PLAY_TRANSFER":
    case "PLAY_SEPARATION":
    case "PLAY_FUNCTION_SEPARATION":
      return decision(command, targetAffinity(action.targetId, ownFaction, beliefs) * 8 + 8, "redirect toward a likely ally");
    case "PLAY_BURN":
      return decision(command, targetAffinity(action.targetPlayerId, ownFaction, beliefs) * 12 + 8, "remove lethal black intelligence from a likely ally");
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
            score: helpful * targetAffinity(target.id, projection.own.faction, beliefs) + cardUtility(card, projection.own.faction) * -0.15,
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
            score: transmissionCardValue(card, projection.own.faction) * targetAffinity(recipient, projection.own.faction, beliefs) - cardUtility(card, projection.own.faction) * 0.15,
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
