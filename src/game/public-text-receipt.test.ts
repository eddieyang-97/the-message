import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type Faction, type PhysicalCardId } from "./cards";
import {
  currentReactionWindow,
  acceptIntelligence,
  choosePublicTextReceiptDiscard,
  choosePublicTextReceiptEffect,
  initializeGame,
  passLockOpportunity,
  passReaction,
  projectGameForPlayer,
  startTransmission,
  type GameState,
} from "./engine";

const players = ["甲", "乙", "丙", "丁", "戊"] as const;

function game(seed: number): GameState {
  const state = initializeGame(players, seed);
  state.activePlayerId = "甲";
  return state;
}

function cardWhere(
  predicate: (card: (typeof PHYSICAL_DECK)[number]) => boolean,
  excluded: readonly PhysicalCardId[] = [],
): PhysicalCardId {
  const card = PHYSICAL_DECK.find(
    (candidate) => predicate(candidate) && !excluded.includes(candidate.id),
  );
  if (!card) throw new Error("找不到测试牌");
  return card.id;
}

function putInHand(state: GameState, playerId: string, wanted: PhysicalCardId): void {
  const target = state.players[playerId];
  if (target.hand.includes(wanted)) return;
  const replacement = target.hand[0];
  const owner = Object.values(state.players).find((player) =>
    player.hand.includes(wanted),
  );
  if (owner) {
    owner.hand[owner.hand.indexOf(wanted)] = replacement;
  } else {
    const drawIndex = state.drawPile.indexOf(wanted);
    if (drawIndex < 0) throw new Error("测试牌不在可用区域");
    state.drawPile[drawIndex] = replacement;
  }
  target.hand[0] = wanted;
}

function moveToIntelligence(
  state: GameState,
  playerId: string,
  wanted: PhysicalCardId,
): void {
  const drawIndex = state.drawPile.indexOf(wanted);
  if (drawIndex >= 0) state.drawPile.splice(drawIndex, 1);
  else {
    const owner = Object.values(state.players).find((player) =>
      player.hand.includes(wanted),
    );
    if (!owner) throw new Error("测试牌不在可用区域");
    owner.hand.splice(owner.hand.indexOf(wanted), 1);
  }
  state.players[playerId].intelligence.push(wanted);
}

function setFaction(state: GameState, playerId: string, faction: Faction): void {
  if (state.players[playerId].faction === faction) return;
  const other = Object.values(state.players).find(
    (player) => player.id !== playerId && player.faction === faction,
  );
  if (!other) throw new Error("找不到可交换阵营的玩家");
  [state.players[playerId].faction, other.faction] = [
    other.faction,
    state.players[playerId].faction,
  ];
}

function acceptPublicText(state: GameState, cardId: PhysicalCardId): void {
  putInHand(state, "甲", cardId);
  startTransmission(state, "甲", cardId, { direction: "clockwise" });
  if (state.transmission?.receiptStage === "lockOffer") {
    passLockOpportunity(state, "甲");
  }
  while (currentReactionWindow(state)) {
    const responder =
      currentReactionWindow(state)!.responderOrder[currentReactionWindow(state)!.nextResponderIndex];
    passReaction(state, responder);
  }
  acceptIntelligence(state, "乙");
}

describe("公开文本作为接收情报", () => {
  it("第三张黑色情报先致死并跳过接收效果", () => {
    const state = game(101);
    const text = cardWhere(
      (card) => card.name === "公开文本" && card.color === "黑",
    );
    const blackOne = cardWhere(
      (card) => card.color === "黑" && card.id !== text,
    );
    const blackTwo = cardWhere(
      (card) => card.color === "黑" && ![text, blackOne].includes(card.id),
    );
    moveToIntelligence(state, "乙", blackOne);
    moveToIntelligence(state, "乙", blackTwo);

    acceptPublicText(state, text);

    expect(state.players["乙"].alive).toBe(false);
    expect(state.players["乙"].factionRevealed).toBe(true);
    expect(state.pendingPublicTextReceipt).toBeUndefined();
    expect(state.auditLog.some((entry) => entry.includes("因公开文本摸"))).toBe(false);
  });

  it("红色版本令潜伏选择并公开弃置一张手牌", () => {
    const state = game(102);
    setFaction(state, "乙", "潜伏");
    const text = cardWhere(
      (card) => card.name === "公开文本" && card.color === "红",
    );
    const discarded = state.players["乙"].hand[0];

    acceptPublicText(state, text);

    expect(state.phase).toBe("resolvingReceipt");
    expect(state.pendingPublicTextReceipt?.stage).toBe("discard");
    expect(projectGameForPlayer(state, "乙").legalActions).toContainEqual({
      type: "CHOOSE_PUBLIC_TEXT_DISCARD",
      cardId: discarded,
    });
    choosePublicTextReceiptDiscard(state, "乙", discarded);

    expect(state.publicDiscard).toContain(discarded);
    const discardedCard = PHYSICAL_DECK.find((card) => card.id === discarded)!;
    expect(state.auditLog).toContain(
      `乙因公开文本弃置一张手牌：「${discardedCard.name}（${discardedCard.color} · ${discardedCard.transmission}）」`,
    );
    expect(state.auditLog).not.toContain("乙选择为公开文本弃置一张手牌");
    expect(state.pendingPublicTextReceipt).toBeUndefined();
    expect(state.activePlayerId).toBe("乙");
  });

  it("强制弃牌时仅有一张手牌则自动弃置", () => {
    const state = game(106);
    setFaction(state, "乙", "潜伏");
    const text = cardWhere(
      (card) => card.name === "公开文本" && card.color === "红",
    );
    state.drawPile.push(...state.players["乙"].hand.splice(1));
    const onlyCard = state.players["乙"].hand[0];

    acceptPublicText(state, text);

    expect(state.players["乙"].hand).not.toContain(onlyCard);
    expect(state.players["乙"].hand).toHaveLength(2);
    expect(state.publicDiscard).toContain(onlyCard);
    const discardedCard = PHYSICAL_DECK.find((card) => card.id === onlyCard)!;
    expect(state.auditLog).toContain(
      `乙因公开文本自动弃置唯一的手牌：「${discardedCard.name}（${discardedCard.color} · ${discardedCard.transmission}）」`,
    );
    expect(state.pendingPublicTextReceipt).toBeUndefined();
  });

  it("非强制阵营可选择摸牌，牌库为空时洗回弃牌继续摸", () => {
    const state = game(103);
    setFaction(state, "乙", "军情");
    const text = cardWhere(
      (card) => card.name === "公开文本" && card.color === "红",
    );
    acceptPublicText(state, text);
    const before = state.players["乙"].hand.length;
    state.publicDiscard.push(...state.drawPile.splice(0));

    expect(projectGameForPlayer(state, "乙").legalActions).toEqual([
      { type: "CHOOSE_PUBLIC_TEXT_EFFECT", choice: "drawOne" },
      { type: "CHOOSE_PUBLIC_TEXT_EFFECT", choice: "discardOne" },
    ]);
    choosePublicTextReceiptEffect(state, "乙", "drawOne");

    // 公开文本摸1张完整结算后，乙成为下一位行动者并再摸回合开始的2张。
    expect(state.players["乙"].hand).toHaveLength(before + 3);
    expect(state.auditLog.some((entry) => entry.includes("弃牌堆洗回牌库"))).toBe(true);
  });

  it("强制弃牌时若接收者没有手牌则效果直接完成", () => {
    const state = game(105);
    setFaction(state, "乙", "军情");
    const text = cardWhere(
      (card) => card.name === "公开文本" && card.color === "蓝",
    );
    state.drawPile.push(...state.players["乙"].hand.splice(0));

    acceptPublicText(state, text);

    expect(state.pendingPublicTextReceipt).toBeUndefined();
    expect(state.phase).toBe("initialized");
    expect(
      state.auditLog.some((entry) => entry.includes("须弃牌，但其没有手牌")),
    ).toBe(true);
  });

  it("接收效果完整结算后才检查胜利", () => {
    const state = game(104);
    setFaction(state, "乙", "军情");
    const text = cardWhere(
      (card) => card.name === "公开文本" && card.color === "蓝",
    );
    const blueOne = cardWhere(
      (card) => card.color === "蓝" && card.id !== text,
    );
    const blueTwo = cardWhere(
      (card) => card.color === "蓝" && ![text, blueOne].includes(card.id),
    );
    moveToIntelligence(state, "乙", blueOne);
    moveToIntelligence(state, "乙", blueTwo);
    const discarded = state.players["乙"].hand[0];

    acceptPublicText(state, text);
    expect(state.winner).toBeUndefined();
    expect(state.phase).toBe("resolvingReceipt");

    choosePublicTextReceiptDiscard(state, "乙", discarded);
    expect(state.winner).toEqual({ kind: "faction", faction: "军情" });
    expect(state.phase).toBe("gameOver");
  });
});
