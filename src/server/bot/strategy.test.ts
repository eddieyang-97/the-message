import { describe, expect, it } from "vitest";
import { PHYSICAL_DECK, type Faction, type PhysicalCard, type PhysicalCardId } from "../../game/cards";
import type { PlayerProjection } from "../../game/engine";
import {
  BASELINE_V1,
  chooseBotCommand,
  createBotMemory,
  createSeededBotRandom,
  factionBeliefs,
  LIVE_BOT_POLICY,
  observeBotProjection,
  receiptUtility,
  TACTICAL_V2,
  TACTICAL_V3,
} from "./strategy";
import { CANDIDATE_V5, CANDIDATE_V6, CANDIDATE_V7, CANDIDATE_V8 } from "../../ai-lab/policies";

const blueCard = cardWhere((card) => card.color === "蓝");
const redDirectCard = cardWhere((card) => card.color === "红" && card.transmission === "直达");
const redPublicText = cardWhere((card) => card.name === "公开文本" && card.color === "红");
const blueDirectCard = cardWhere((card) => card.color === "蓝" && card.transmission === "直达");
const blackCard = cardWhere((card) => card.color === "黑");
const counterCard = cardWhere((card) => card.name === "识破");
const transferCard = cardWhere((card) => card.name === "转移");
const separationCard = cardWhere((card) => card.name === "离间");
const lureCard = cardWhere((card) => card.name === "调虎离山");
const blueMailCard = cardWhere((card) => card.color === "蓝" && card.transmission === "密电");
const secretOrderCard = cardWhere((card) => card.variant?.kind === "secretOrder");
const redSwapCard = cardWhere((card) => card.name === "掉包" && card.color === "红");
const blueSwapCard = cardWhere((card) => card.name === "掉包" && card.color === "蓝");
const militaryDrawProbe = cardWhere(
  (card) => card.variant?.kind === "probeDrawDiscard" && card.variant.drawFaction === "军情",
);
const undercoverDrawProbe = cardWhere(
  (card) => card.variant?.kind === "probeDrawDiscard" && card.variant.drawFaction === "潜伏",
);

describe("bot strategy", () => {
  it("promotes the candidate-v5 configuration as tactical-v3 while retaining tactical-v2", () => {
    expect(LIVE_BOT_POLICY).toBe(TACTICAL_V3);
    expect({ ...CANDIDATE_V5, id: TACTICAL_V3.id }).toEqual(TACTICAL_V3);
    expect(TACTICAL_V2.id).toBe("tactical-v2");
  });

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

  it("treats a visible secret-order color as weak evidence of the orderer's faction", () => {
    const offering = makeProjection({
      phase: "preTransmission",
      pendingSecretOrder: {
        stage: "offering",
        targetPlayerId: "bot",
        verifiedNoMatch: false,
      },
    });
    const memory = createBotMemory(offering);
    const ordered = makeProjection({
      phase: "preTransmission",
      pendingSecretOrder: {
        stage: "selection",
        sourcePlayerId: "b",
        targetPlayerId: "bot",
        word: "听风",
        requiredColor: "蓝",
        verifiedNoMatch: false,
      },
    });

    observeBotProjection(memory, ordered);

    expect(memory.evidence.b.军情).toBeGreaterThan(memory.evidence.b.潜伏);

    const uninformed = createBotMemory({
      ...ordered,
      pendingSecretOrder: { ...ordered.pendingSecretOrder!, requiredColor: undefined },
    });
    expect(uninformed.evidence.b.军情).toBe(0);
    expect(uninformed.evidence.b.潜伏).toBe(0);
  });

  it("retains the secret-order color constraint for the following hidden transmission", () => {
    const ordered = makeProjection({
      phase: "preTransmission",
      auditLog: ["bot使用秘密下达并宣布：日落"],
      pendingSecretOrder: {
        stage: "selection",
        sourcePlayerId: "bot",
        targetPlayerId: "b",
        word: "日落",
        requiredColor: "黑",
        verifiedNoMatch: false,
      },
    });
    const memory = createBotMemory(ordered);
    const hiddenBlack = makeProjection({
      phase: "transmitting",
      players: makeProjection().players.map((player) =>
        player.id === "bot"
          ? { ...player, intelligence: [blackCard, { ...blackCard, id: "second-black" }] }
          : player
      ),
      transmission: {
        ...transmission(blackCard),
        card: undefined,
        faceUp: false,
        senderId: "b",
        intendedRecipientId: "bot",
      },
      auditLog: [
        ...ordered.auditLog,
        "b开始以密电传递情报，当前接收者：bot",
      ],
      legalActions: [{ type: "ACCEPT_INTELLIGENCE" }, { type: "DECLINE_INTELLIGENCE" }],
    });

    expect(chooseBotCommand(hiddenBlack, memory)?.type).toBe("DECLINE_INTELLIGENCE");
    expect(memory.transmissionInference?.forcedColor).toBe("黑");
  });

  it.each([
    "b声明无匹配牌并通过服务器验证",
    "秘密下达被识破，颜色限制取消",
  ])("does not retain an invalidated secret-order constraint: %s", (invalidationEntry) => {
    const ordered = makeProjection({
      phase: "preTransmission",
      auditLog: ["bot使用秘密下达并宣布：日落"],
      pendingSecretOrder: {
        stage: "selection",
        sourcePlayerId: "bot",
        targetPlayerId: "b",
        word: "日落",
        requiredColor: "黑",
        verifiedNoMatch: false,
      },
    });
    const memory = createBotMemory(ordered);
    const transmissionStarted = makeProjection({
      phase: "transmitting",
      transmission: {
        ...transmission(blackCard),
        card: undefined,
        faceUp: false,
        senderId: "b",
      },
      auditLog: [
        ...ordered.auditLog,
        invalidationEntry,
        "b开始以密电传递情报，当前接收者：bot",
      ],
    });

    observeBotProjection(memory, transmissionStarted);

    expect(memory.transmissionInference?.forcedColor).toBeUndefined();
  });

  it("掉包结算后不再将秘密下达颜色当作替换牌的颜色", () => {
    const ordered = makeProjection({
      phase: "preTransmission",
      auditLog: ["bot使用秘密下达并宣布：日落"],
      pendingSecretOrder: {
        stage: "selection",
        sourcePlayerId: "bot",
        targetPlayerId: "b",
        word: "日落",
        requiredColor: "黑",
        verifiedNoMatch: false,
      },
    });
    const memory = createBotMemory(ordered);
    const transmissionStarted = makeProjection({
      phase: "transmitting",
      transmission: { ...transmission(blackCard), card: undefined, faceUp: false, senderId: "b" },
      auditLog: [
        ...ordered.auditLog,
        "b开始以密电传递情报，当前接收者：bot",
      ],
    });
    observeBotProjection(memory, transmissionStarted);
    expect(memory.transmissionInference?.forcedColor).toBe("黑");

    observeBotProjection(memory, {
      ...transmissionStarted,
      auditLog: [...transmissionStarted.auditLog, "掉包结算：原情报公开弃置；替换牌正面朝上"],
    });

    expect(memory.transmissionInference?.forcedColor).toBeUndefined();
  });

  it("treats a forced public-text discard as definitive faction evidence", () => {
    const forced = makeProjection({
      phase: "resolvingReceipt",
      players: makeProjection().players.map((player) =>
        player.id === "b" ? { ...player, intelligence: [redPublicText] } : player
      ),
      auditLog: [
        "b接收情报：「公开文本（红 · 文本）」",
        "b须为公开文本选择一张手牌弃置",
      ],
    });
    const forcedMemory = createBotMemory(forced);
    expect(factionBeliefs(forcedMemory, forced).b).toEqual({ 军情: 0, 潜伏: 1, 特工: 0 });

    const optional = makeProjection({
      phase: "resolvingReceipt",
      players: makeProjection().players.map((player) =>
        player.id === "b" ? { ...player, intelligence: [redPublicText] } : player
      ),
      auditLog: [
        "b接收情报：「公开文本（红 · 文本）」",
        "b须选择公开文本的摸牌或弃牌效果",
        "b因公开文本弃置一张手牌：「锁定（红 · 直达）」",
      ],
    });
    expect(factionBeliefs(createBotMemory(optional), optional).b.潜伏).toBeLessThan(1);
  });

  it("rules out factions whose victory thresholds were passed without winning", () => {
    const threeRed = [
      redDirectCard,
      { ...redDirectCard, id: "second-red" },
      { ...redDirectCard, id: "third-red" },
    ];
    const continued = makeProjection({
      phase: "transmitting",
      players: makeProjection().players.map((player) =>
        player.id === "b" ? { ...player, intelligence: threeRed } : player
      ),
    });
    expect(factionBeliefs(createBotMemory(continued), continued).b.潜伏).toBe(0);

    const stillResolving = { ...continued, phase: "resolvingReceipt" as const };
    expect(factionBeliefs(createBotMemory(stillResolving), stillResolving).b.潜伏).toBeGreaterThan(0);
  });

  it("treats receiving the +1 probe outcome as evidence that the sender is a teammate", () => {
    const duringProbe = makeProjection({
      own: { id: "bot", faction: "军情", hand: [counterCard] },
      activeFunctionAction: {
        kind: "probeDrawDiscard",
        sourcePlayerId: "b",
        targetPlayerId: "bot",
        stage: "reactions",
      },
    });
    const memory = createBotMemory(duringProbe);
    const before = memory.evidence.b?.军情 ?? 0;
    const afterProbe = makeProjection({
      own: { id: "bot", faction: "军情", hand: [counterCard, transferCard] },
      players: duringProbe.players.map((player) =>
        player.id === "bot" ? { ...player, handCount: player.handCount + 1 } : player
      ),
      activeFunctionAction: undefined,
    });

    observeBotProjection(memory, afterProbe);

    expect(memory.evidence.b.军情).toBeGreaterThan(before);
    expect(memory.evidence.b.军情).toBeGreaterThan(memory.evidence.b.潜伏);
  });

  it("does not treat another 特工 as a teammate after receiving +1", () => {
    const duringProbe = makeProjection({
      own: { id: "bot", faction: "特工", hand: [counterCard] },
      activeFunctionAction: {
        kind: "probeDrawDiscard",
        sourcePlayerId: "b",
        targetPlayerId: "bot",
        stage: "reactions",
      },
    });
    const memory = createBotMemory(duringProbe);
    const afterProbe = makeProjection({
      own: { id: "bot", faction: "特工", hand: [counterCard, transferCard] },
      players: duringProbe.players.map((player) =>
        player.id === "bot" ? { ...player, handCount: player.handCount + 1 } : player
      ),
      activeFunctionAction: undefined,
    });

    observeBotProjection(memory, afterProbe);

    expect(memory.evidence.b.特工).toBe(0);
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

  it("treats a publicly observed decrypt followed by rejection as evidence of black intelligence", () => {
    const hiddenTransmission = {
      ...transmission(blackCard),
      intendedRecipientId: "c",
      card: undefined,
      faceUp: false,
    };
    const initial = makeProjection({
      phase: "transmitting",
      transmission: hiddenTransmission,
      auditLog: ["b开始以密电传递情报，当前接收者：c"],
    });
    const memory = createBotMemory(initial);
    const afterDecryptRejection = makeProjection({
      phase: "transmitting",
      players: makeProjection().players.map((player) =>
        player.id === "bot"
          ? { ...player, intelligence: [blackCard, { ...blackCard, id: "second-black" }] }
          : player
      ),
      transmission: { ...hiddenTransmission, intendedRecipientId: "bot" },
      auditLog: [
        "b开始以密电传递情报，当前接收者：c",
        "c完成破译",
        "c拒绝情报，当前接收者：bot",
      ],
      legalActions: [{ type: "ACCEPT_INTELLIGENCE" }, { type: "DECLINE_INTELLIGENCE" }],
    });

    expect(chooseBotCommand(afterDecryptRejection, memory)?.type).toBe("DECLINE_INTELLIGENCE");
    expect(memory.transmissionInference?.blackProbability).toBe(0.7);
  });

  it("candidate-v5 preserves a marginal reaction card under faction uncertainty", () => {
    const projection = makeProjection({
      phase: "transmitting",
      own: { id: "bot", faction: "特工", hand: [transferCard] },
      transmission: { ...transmission(blueCard), card: undefined, faceUp: false },
      legalActions: [
        { type: "PASS_REACTION" },
        { type: "PLAY_TRANSFER", cardId: transferCard.id as PhysicalCardId, targetId: "b" },
      ],
    });

    expect(chooseBotCommand(projection, createBotMemory(projection), { policy: TACTICAL_V2 })?.type)
      .toBe("PLAY_TRANSFER");
    expect(chooseBotCommand(projection, createBotMemory(projection), { policy: CANDIDATE_V5 })?.type)
      .toBe("PASS_REACTION");
    expect(chooseBotCommand(projection, createBotMemory(projection))?.type)
      .toBe("PASS_REACTION");
    expect(chooseBotCommand(projection, createBotMemory(projection), { policy: CANDIDATE_V6 })?.type)
      .toBe("PLAY_TRANSFER");
  });

  it("candidate-v7 transfers only for improvement over the current recipient", () => {
    const chooseTransfer = (currentIntelligence: PhysicalCard, ownIntelligence: PhysicalCard[]) => {
      const projection = makeProjection({
        phase: "transmitting",
        own: { id: "bot", faction: "军情", hand: [transferCard] },
        players: makeProjection().players.map((player) =>
          player.id === "bot" ? { ...player, intelligence: ownIntelligence } : player
        ),
        transmission: transmission(currentIntelligence),
        legalActions: [
          { type: "PASS_REACTION" },
          { type: "PLAY_TRANSFER", cardId: transferCard.id as PhysicalCardId, targetId: "b" },
        ],
      });
      return chooseBotCommand(projection, createBotMemory(projection), { policy: CANDIDATE_V7 })?.type;
    };

    expect(chooseTransfer(blueCard, [])).toBe("PASS_REACTION");
    expect(chooseTransfer(blackCard, [blackCard, { ...blackCard, id: "second-black" }]))
      .toBe("PLAY_TRANSFER");
  });

  it("candidate-v8 uses lure only when the forced next recipient improves the receipt", () => {
    const chooseLure = (currentFaction: Faction, nextFaction: Faction, policy = CANDIDATE_V8) => {
      const projection = makeProjection({
        phase: "transmitting",
        own: { id: "bot", faction: "军情", hand: [lureCard] },
        players: makeProjection().players.map((player) =>
          player.id === "b"
            ? { ...player, faction: currentFaction }
            : player.id === "c"
              ? { ...player, faction: nextFaction }
              : player
        ),
        transmission: {
          ...transmission(blueMailCard),
          intendedRecipientId: "b",
          direction: "clockwise",
        },
        legalActions: [
          { type: "PASS_REACTION" },
          { type: "PLAY_LURE", cardId: lureCard.id as PhysicalCardId },
        ],
      });
      return chooseBotCommand(projection, createBotMemory(projection), { policy })?.type;
    };

    expect(chooseLure("军情", "潜伏")).toBe("PASS_REACTION");
    expect(chooseLure("潜伏", "军情")).toBe("PLAY_LURE");
    expect(chooseLure("军情", "潜伏", TACTICAL_V3)).toBe("PLAY_LURE");
  });

  it("does not order a known opponent to transmit their game-winning color", () => {
    if (secretOrderCard.variant?.kind !== "secretOrder") throw new Error("Expected secret-order fixture");
    const projection = makeProjection({
      phase: "preTransmission",
      activePlayerId: "b",
      own: { id: "bot", faction: "潜伏", hand: [secretOrderCard] },
      players: makeProjection().players.map((player) => {
        if (player.id === "b") {
          return { ...player, intelligence: [blueCard, { ...blueCard, id: "second-blue" }] };
        }
        if (player.id === "c") return { ...player, alive: false, faction: "军情" as Faction };
        if (player.id === "d") return { ...player, alive: false, faction: "潜伏" as Faction };
        if (player.id === "e") return { ...player, alive: false, faction: "特工" as Faction };
        return player;
      }),
      pendingSecretOrder: {
        stage: "offering",
        targetPlayerId: "b",
        verifiedNoMatch: false,
      },
      legalActions: [
        { type: "PASS_REACTION" },
        ...(["听风", "看雨", "日落"] as const).map((word) => ({
          type: "PLAY_SECRET_ORDER" as const,
          cardId: secretOrderCard.id as PhysicalCardId,
          word,
        })),
      ],
    });

    const command = chooseBotCommand(projection, createBotMemory(projection));
    expect(command?.type).toBe("PLAY_SECRET_ORDER");
    if (command?.type !== "PLAY_SECRET_ORDER") throw new Error("Expected secret order");
    expect(secretOrderCard.variant.mapping[command.word]).not.toBe("蓝");
  });

  it("uses separation only for enough incremental improvement over the pending transfer target", () => {
    const chooseSeparation = (
      players: PlayerProjection["players"],
      pendingTargetId: string,
      proposedTargetId: string,
    ) => {
      const projection = makeProjection({
        phase: "transmitting",
        players,
        own: { id: "bot", faction: "军情", hand: [separationCard] },
        transmission: {
          ...transmission(blueDirectCard),
          pendingTransfer: { sourceCard: transferCard, targetId: pendingTargetId },
        },
        legalActions: [
          { type: "PASS_REACTION" },
          {
            type: "PLAY_SEPARATION",
            cardId: separationCard.id as PhysicalCardId,
            targetId: proposedTargetId,
          },
        ],
      });
      return chooseBotCommand(projection, createBotMemory(projection), { policy: TACTICAL_V2 });
    };
    const hiddenPlayers = makeProjection().players;
    const revealedPlayers = hiddenPlayers.map((player) =>
      player.id === "b"
        ? { ...player, faction: "军情" as Faction }
        : player.id === "c"
          ? { ...player, faction: "潜伏" as Faction }
          : player
    );

    expect(chooseSeparation(hiddenPlayers, "b", "c")?.type).toBe("PASS_REACTION");
    expect(chooseSeparation(revealedPlayers, "b", "c")?.type).toBe("PASS_REACTION");
    expect(chooseSeparation(revealedPlayers, "c", "b")?.type).toBe("PLAY_SEPARATION");
  });

  it("redirects 危险情报 toward an opponent and never toward itself", () => {
    const projection = makeProjection({
      own: { id: "bot", faction: "军情", hand: [separationCard] },
      players: makeProjection().players.map((player) =>
        player.id === "c"
          ? { ...player, faction: "军情" as Faction }
          : player.id === "d"
            ? { ...player, faction: "潜伏" as Faction }
            : player
      ),
      activeFunctionAction: {
        kind: "dangerousIntelligence",
        sourcePlayerId: "b",
        targetPlayerId: "c",
        stage: "reactions",
      },
      legalActions: [
        { type: "PASS_REACTION" },
        {
          type: "PLAY_FUNCTION_SEPARATION",
          cardId: separationCard.id as PhysicalCardId,
          targetId: "bot",
        },
        {
          type: "PLAY_FUNCTION_SEPARATION",
          cardId: separationCard.id as PhysicalCardId,
          targetId: "d",
        },
      ],
    });

    expect(chooseBotCommand(projection, createBotMemory(projection))).toMatchObject({
      type: "PLAY_FUNCTION_SEPARATION",
      targetId: "d",
    });

    const selfOnly = {
      ...projection,
      legalActions: projection.legalActions.filter((action) =>
        action.type === "PASS_REACTION" ||
        (action.type === "PLAY_FUNCTION_SEPARATION" && action.targetId === "bot")
      ),
    };
    expect(chooseBotCommand(selfOnly, createBotMemory(selfOnly))?.type).toBe("PASS_REACTION");
  });

  it("uses swap only when the replacement materially improves the pending intelligence", () => {
    const players = makeProjection().players.map((player) =>
      player.id === "b" ? { ...player, faction: "军情" as Faction } : player
    );
    const chooseSwap = (currentCard: PhysicalCard, replacement: PhysicalCard) => {
      const projection = makeProjection({
        phase: "transmitting",
        players,
        own: { id: "bot", faction: "军情", hand: [replacement] },
        transmission: { ...transmission(currentCard), intendedRecipientId: "b" },
        legalActions: [
          { type: "PASS_REACTION" },
          { type: "PLAY_SWAP", cardId: replacement.id as PhysicalCardId },
        ],
      });
      return chooseBotCommand(projection, createBotMemory(projection), { policy: TACTICAL_V2 });
    };

    expect(chooseSwap(redDirectCard, redSwapCard)?.type).toBe("PASS_REACTION");
    expect(chooseSwap(blueDirectCard, redSwapCard)?.type).toBe("PASS_REACTION");
    expect(chooseSwap(redDirectCard, blueSwapCard)?.type).toBe("PLAY_SWAP");
  });

  it("uses a draw probe on a likely ally when its printed draw faction matches", () => {
    const projection = makeProjection({
      own: { id: "bot", faction: "军情", hand: [militaryDrawProbe] },
      players: makeProjection().players.map((player) =>
        player.id === "b"
          ? { ...player, faction: "军情" as Faction }
          : player.id === "c"
            ? { ...player, faction: "潜伏" as Faction }
            : player
      ),
      legalActions: [
        { type: "PLAY_PROBE", cardId: militaryDrawProbe.id as PhysicalCardId, targetId: "b" },
        { type: "PLAY_PROBE", cardId: militaryDrawProbe.id as PhysicalCardId, targetId: "c" },
      ],
    });

    expect(chooseBotCommand(projection, createBotMemory(projection))).toMatchObject({
      type: "PLAY_PROBE",
      targetId: "b",
    });
  });

  it("avoids giving a draw to a likely opponent and probes an opponent who must discard", () => {
    const projection = makeProjection({
      own: { id: "bot", faction: "军情", hand: [undercoverDrawProbe] },
      players: makeProjection().players.map((player) =>
        player.id === "b"
          ? { ...player, faction: "潜伏" as Faction }
          : player.id === "c"
            ? { ...player, faction: "特工" as Faction }
            : player
      ),
      legalActions: [
        { type: "PLAY_PROBE", cardId: undercoverDrawProbe.id as PhysicalCardId, targetId: "b" },
        { type: "PLAY_PROBE", cardId: undercoverDrawProbe.id as PhysicalCardId, targetId: "c" },
      ],
    });

    expect(chooseBotCommand(projection, createBotMemory(projection))).toMatchObject({
      type: "PLAY_PROBE",
      targetId: "c",
    });
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
    expect(chooseBotCommand(projection, createBotMemory(projection), { policy: CANDIDATE_V5 })?.type)
      .toBe("ACCEPT_INTELLIGENCE");
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
    expect(chooseBotCommand(projection, memory, { policy: TACTICAL_V2, random: () => 0.99 })?.type)
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
    expect(chooseBotCommand(helpful, createBotMemory(helpful), { policy: BASELINE_V1 })?.type)
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
