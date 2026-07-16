import { describe, expect, it } from "vitest";
import { PHYSICAL_DECK, type Faction, type PhysicalCard, type PhysicalCardId } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import {
  chooseBotCommand,
  createBotMemory,
  createSeededBotRandom,
  factionBeliefs,
  observeBotProjection,
  receiptUtility,
} from "./bot-strategy";

const blueCard = cardWhere((card) => card.color === "蓝");
const redDirectCard = cardWhere((card) => card.color === "红" && card.transmission === "直达");
const blueDirectCard = cardWhere((card) => card.color === "蓝" && card.transmission === "直达");
const blackCard = cardWhere((card) => card.color === "黑");
const counterCard = cardWhere((card) => card.name === "识破");

describe("bot strategy", () => {
  it("selects only a supplied legal action during normal prompts", () => {
    const projection = makeProjection({
      legalActions: [{ type: "CHOOSE_PROBE_IDENTITY", choice: "announce" }],
    });
    const command = chooseBotCommand(projection, createBotMemory(projection));
    expect(command).toEqual({ type: "CHOOSE_PROBE_IDENTITY", choice: "announce" });
  });

  it("learns a weak faction signal from newly received public intelligence", () => {
    const initial = makeProjection();
    const memory = createBotMemory(initial);
    const before = factionBeliefs(memory, initial).b.军情;
    const updated = makeProjection({
      players: initial.players.map((player) =>
        player.id === "b" ? { ...player, intelligence: [blueCard] } : player
      ),
    });
    observeBotProjection(memory, updated);
    expect(memory.evidence.b.军情).toBeGreaterThan(0);
    expect(factionBeliefs(memory, updated).b.军情).toBeGreaterThan(before);
  });

  it("infers sender alignment from a face-up transmission to a revealed player", () => {
    const initial = makeProjection({
      players: makeProjection().players.map((player) =>
        player.id === "c" ? { ...player, faction: "军情" as Faction } : player
      ),
    });
    const memory = createBotMemory(initial);
    const withTransmission = {
      ...initial,
      phase: "transmitting" as const,
      transmission: { ...transmission(blueCard), senderId: "b", intendedRecipientId: "c" },
    };
    observeBotProjection(memory, withTransmission);
    expect(memory.evidence.b.军情).toBeGreaterThan(memory.evidence.b.潜伏);
  });

  it("treats publicly revealed factions as certain", () => {
    const projection = makeProjection({
      players: makeProjection().players.map((player) =>
        player.id === "c" ? { ...player, faction: "潜伏" as Faction } : player
      ),
    });
    const beliefs = factionBeliefs(createBotMemory(projection), projection);
    expect(beliefs.c).toEqual({ 军情: 0, 潜伏: 1, 特工: 0 });
  });

  it("conditions faction priors on the bot's privately known faction in a duel", () => {
    const projection = makeProjection({
      mode: "duel",
      seatOrder: ["bot", "b"],
      players: [
        { id: "bot", alive: true, handCount: 2, intelligence: [] },
        { id: "b", alive: true, handCount: 2, intelligence: [] },
      ],
    });
    expect(factionBeliefs(createBotMemory(projection), projection).b).toEqual({
      军情: 0,
      潜伏: 1,
      特工: 0,
    });
  });

  it("keeps joint beliefs consistent with the exact faction distribution", () => {
    const projection = makeProjection({
      players: makeProjection().players.map((player) => {
        if (player.id === "c") return { ...player, faction: "军情" as Faction };
        if (player.id === "d") return { ...player, faction: "潜伏" as Faction };
        return player;
      }),
    });
    const beliefs = factionBeliefs(createBotMemory(projection), projection);

    expect(beliefs.b.军情).toBe(0);
    expect(beliefs.e.军情).toBe(0);
    expect(sumFaction(beliefs, "军情")).toBeCloseTo(2);
    expect(sumFaction(beliefs, "潜伏")).toBeCloseTo(2);
    expect(sumFaction(beliefs, "特工")).toBeCloseTo(1);
  });

  it("couples hidden-player beliefs instead of allowing impossible independent totals", () => {
    const projection = makeProjection({
      players: makeProjection().players.map((player) => {
        if (player.id === "c") return { ...player, faction: "军情" as Faction };
        if (player.id === "d") return { ...player, faction: "潜伏" as Faction };
        return player;
      }),
    });
    const memory = createBotMemory(projection);
    memory.evidence.b = { 军情: -8, 潜伏: -8, 特工: 8 };
    const beliefs = factionBeliefs(memory, projection);

    expect(beliefs.b.特工).toBeGreaterThan(0.99);
    expect(beliefs.e.潜伏).toBeGreaterThan(0.99);
    expect(beliefs.e.特工).toBeLessThan(0.01);
  });

  it("accepts matching intelligence and declines lethal black intelligence", () => {
    const helpful = makeProjection({
      phase: "transmitting",
      transmission: transmission(blueCard),
      legalActions: [{ type: "ACCEPT_INTELLIGENCE" }, { type: "DECLINE_INTELLIGENCE" }],
    });
    expect(chooseBotCommand(helpful, createBotMemory(helpful))?.type).toBe("ACCEPT_INTELLIGENCE");

    const lethal = makeProjection({
      phase: "transmitting",
      players: makeProjection().players.map((player) =>
        player.id === "bot" ? { ...player, intelligence: [blackCard, { ...blackCard, id: "another-black" }] } : player
      ),
      transmission: transmission(blackCard),
      legalActions: [{ type: "ACCEPT_INTELLIGENCE" }, { type: "DECLINE_INTELLIGENCE" }],
    });
    expect(chooseBotCommand(lethal, createBotMemory(lethal))?.type).toBe("DECLINE_INTELLIGENCE");
  });

  it("assigns decisive tactical value to an immediate team win", () => {
    const projection = makeProjection({
      phase: "transmitting",
      players: makeProjection().players.map((player) =>
        player.id === "bot"
          ? { ...player, intelligence: [blueCard, { ...blueCard, id: "second-blue" }] }
          : player
      ),
      transmission: transmission(blueCard),
      legalActions: [{ type: "ACCEPT_INTELLIGENCE" }, { type: "DECLINE_INTELLIGENCE" }],
    });
    const memory = createBotMemory(projection);
    expect(receiptUtility(blueCard, "bot", projection, factionBeliefs(memory, projection))).toBeGreaterThan(9_000);
    expect(chooseBotCommand(projection, memory)?.type).toBe("ACCEPT_INTELLIGENCE");
  });

  it("accepts hidden sixth intelligence when it guarantees a 特工 victory", () => {
    const safeIntelligence = [
      ...PHYSICAL_DECK.filter((card) => card.color !== "黑").slice(0, 4),
      blackCard,
    ];
    const projection = makeProjection({
      phase: "transmitting",
      own: { id: "bot", faction: "特工", hand: [counterCard] },
      players: makeProjection().players.map((player) =>
        player.id === "bot" ? { ...player, intelligence: safeIntelligence } : player
      ),
      transmission: { ...transmission(blueCard), card: undefined, faceUp: false },
      legalActions: [{ type: "ACCEPT_INTELLIGENCE" }, { type: "DECLINE_INTELLIGENCE" }],
    });
    const memory = createBotMemory(projection);
    expect(receiptUtility(undefined, "bot", projection, factionBeliefs(memory, projection)))
      .toBeGreaterThan(9_000);
    expect(chooseBotCommand(projection, memory, { policy: "tactical-v2", random: () => 0.99 })?.type)
      .toBe("ACCEPT_INTELLIGENCE");
  });

  it("counters hostile actions but preserves 识破 when the pending action helps", () => {
    const hostile = makeProjection({
      own: { id: "bot", faction: "军情", hand: [counterCard] },
      responseStack: [{
        id: "danger",
        kind: "card",
        sourcePlayerId: "b",
        targetPlayerId: "bot",
        cardName: "危险情报",
      }],
      legalActions: [
        { type: "PASS_REACTION" },
        { type: "PLAY_COUNTER", cardId: counterCard.id as PhysicalCardId, targetInteractionId: "danger" },
      ],
    });
    expect(chooseBotCommand(hostile, createBotMemory(hostile))?.type).toBe("PLAY_COUNTER");

    const helpful: PlayerProjection = {
      ...hostile,
      responseStack: [{
        id: "support",
        kind: "card" as const,
        sourcePlayerId: "bot",
        targetPlayerId: "bot",
        cardName: "增援" as const,
      }],
      legalActions: [
        { type: "PASS_REACTION" as const },
        { type: "PLAY_COUNTER" as const, cardId: counterCard.id as PhysicalCardId, targetInteractionId: "support" },
      ],
    };
    expect(chooseBotCommand(helpful, createBotMemory(helpful))?.type).toBe("PASS_REACTION");
    expect(chooseBotCommand(helpful, createBotMemory(helpful), { policy: "baseline-v1" })?.type)
      .toBe("PLAY_COUNTER");
  });

  it("does not hand matching intelligence to a likely opposing faction", () => {
    const projection = makeProjection({
      phase: "preTransmission",
      own: { id: "bot", faction: "军情", hand: [redDirectCard] },
      legalActions: [],
    });
    const memory = createBotMemory(projection);
    memory.evidence.b = { 军情: 5, 潜伏: -5, 特工: -5 };
    memory.evidence.c = { 军情: -5, 潜伏: 5, 特工: -5 };
    expect(chooseBotCommand(projection, memory)).toEqual({
      type: "START_TRANSMISSION",
      cardId: redDirectCard.id,
      method: "直达",
      targetId: "b",
    });
  });

  it("prioritizes its own immediate team win over giving an opponent theirs", () => {
    const projection = makeProjection({
      phase: "preTransmission",
      own: { id: "bot", faction: "军情", hand: [blueDirectCard, redDirectCard] },
      players: makeProjection().players.map((player) => {
        if (player.id === "b") return { ...player, intelligence: [blueCard, { ...blueCard, id: "ally-blue-2" }] };
        if (player.id === "c") return { ...player, intelligence: [redDirectCard, { ...redDirectCard, id: "enemy-red-2" }] };
        return player;
      }),
      legalActions: [],
    });
    const memory = createBotMemory(projection);
    memory.evidence.b = { 军情: 8, 潜伏: -8, 特工: -8 };
    memory.evidence.c = { 军情: -8, 潜伏: 8, 特工: -8 };
    expect(chooseBotCommand(projection, memory)).toMatchObject({
      type: "START_TRANSMISSION",
      cardId: blueDirectCard.id,
      targetId: "b",
    });
  });

  it("obeys a visible secret-order color when synthesizing transmission", () => {
    const projection = makeProjection({
      phase: "preTransmission",
      own: { id: "bot", faction: "军情", hand: [blueDirectCard, redDirectCard] },
      pendingSecretOrder: {
        stage: "selection",
        targetPlayerId: "bot",
        sourcePlayerId: "b",
        word: "看雨",
        requiredColor: "红",
        verifiedNoMatch: false,
      },
      legalActions: [],
    });
    expect(chooseBotCommand(projection, createBotMemory(projection))).toMatchObject({
      type: "START_TRANSMISSION",
      cardId: redDirectCard.id,
    });
  });

  it("supports reproducible random tie breaking", () => {
    const projection = makeProjection({
      legalActions: [{ type: "PASS_REACTION" }, { type: "PASS_REACTION" }],
    });
    const first = createSeededBotRandom(1234);
    const second = createSeededBotRandom(1234);
    expect([first(), first(), first()]).toEqual([second(), second(), second()]);
    expect(chooseBotCommand(projection, createBotMemory(projection), { random: createSeededBotRandom(9) }))
      .toEqual({ type: "PASS_REACTION" });
  });
});

function makeProjection(overrides: Partial<PlayerProjection> = {}): PlayerProjection {
  const ids = ["bot", "b", "c", "d", "e"];
  const base: PlayerProjection = {
    mode: "standard",
    phase: "initialized",
    activePlayerId: "bot",
    seatOrder: ids,
    drawPileCount: 50,
    publicDiscard: [],
    players: ids.map((id) => ({ id, alive: true, handCount: id === "bot" ? 2 : 2, intelligence: [] })),
    own: { id: "bot", faction: "军情", hand: [blueCard, redDirectCard] },
    auditLog: [],
    privateNotices: [],
    responseStack: [],
    legalActions: [],
  };
  return { ...base, ...overrides };
}

function transmission(card: PhysicalCard): NonNullable<PlayerProjection["transmission"]> {
  return {
    senderId: "b",
    method: card.transmission === "任意" ? "直达" : card.transmission,
    intendedRecipientId: "bot",
    card,
    returnedToSender: false,
    transferredRecipientCommitted: false,
    receiptStage: "decision",
    locked: false,
    faceUp: true,
  };
}

function cardWhere(predicate: (card: PhysicalCard) => boolean): PhysicalCard {
  const card = PHYSICAL_DECK.find(predicate);
  if (!card) throw new Error("Expected physical card fixture");
  return card;
}

function sumFaction(
  beliefs: Record<string, { 军情: number; 潜伏: number; 特工: number }>,
  faction: Faction,
): number {
  return Object.values(beliefs).reduce((sum, belief) => sum + belief[faction], 0);
}
