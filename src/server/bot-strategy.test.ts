import { describe, expect, it } from "vitest";
import { PHYSICAL_DECK, type Faction, type PhysicalCard } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import {
  chooseBotCommand,
  createBotMemory,
  createSeededBotRandom,
  factionBeliefs,
  observeBotProjection,
} from "./bot-strategy";

const blueCard = cardWhere((card) => card.color === "蓝");
const redDirectCard = cardWhere((card) => card.color === "红" && card.transmission === "直达");
const blueDirectCard = cardWhere((card) => card.color === "蓝" && card.transmission === "直达");
const blackCard = cardWhere((card) => card.color === "黑");

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

  it("synthesizes START_TRANSMISSION and targets a likely opponent with harmful intelligence", () => {
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
      targetId: "c",
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
