import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCardId } from "./cards";
import {
  acceptIntelligence,
  assertGameStateInvariants,
  discardForHandLimit,
  enterTransmissionPhase,
  declineIntelligence,
  initializeGame,
  passLockOpportunity,
  passReaction,
  playCounter,
  playDecrypt,
  playIntercept,
  playLock,
  playLure,
  playSeparationOnTransfer,
  playSwap,
  playTransfer,
  projectGameForPlayer,
  startTransmission,
  type GameState,
} from "./engine";

const players = ["甲", "乙", "丙", "丁", "戊"] as const;

function initializedWithActive(
  playerIds: readonly string[],
  seed: number,
  activePlayerId = "甲",
): GameState {
  const state = initializeGame(playerIds, seed);
  state.activePlayerId = activePlayerId;
  return state;
}

function passAllReactions(state: GameState): void {
  if (state.transmission?.receiptStage === "lockOffer") {
    passLockOpportunity(state, state.transmission.senderId);
  }
  while (state.reactionWindow) {
    passReaction(
      state,
      state.reactionWindow.responderOrder[
        state.reactionWindow.nextResponderIndex
      ],
    );
  }
}

function passUntilReactionTurn(state: GameState, actorId: string): void {
  if (state.transmission?.receiptStage === "lockOffer") {
    passLockOpportunity(state, state.transmission.senderId);
  }
  while (
    state.reactionWindow &&
    state.reactionWindow.responderOrder[
      state.reactionWindow.nextResponderIndex
    ] !== actorId
  ) {
    passReaction(
      state,
      state.reactionWindow.responderOrder[
        state.reactionWindow.nextResponderIndex
      ],
    );
  }
}

function finishCurrentReactionWindow(state: GameState): void {
  const originalWindow = state.reactionWindow;
  if (!originalWindow) throw new Error("测试要求存在响应窗口");
  while (state.reactionWindow === originalWindow) {
    passReaction(
      state,
      originalWindow.responderOrder[originalWindow.nextResponderIndex],
    );
  }
}

function acceptAfterReactions(state: GameState, actorId: string): void {
  passAllReactions(state);
  acceptIntelligence(state, actorId);
}

function declineAfterReactions(state: GameState, actorId: string): void {
  passAllReactions(state);
  declineIntelligence(state, actorId);
}

function cardIdWhere(
  predicate: (card: (typeof PHYSICAL_DECK)[number]) => boolean,
  excluded: readonly PhysicalCardId[] = [],
): PhysicalCardId {
  const card = PHYSICAL_DECK.find(
    (candidate) => predicate(candidate) && !excluded.includes(candidate.id),
  );
  if (!card) throw new Error("找不到测试所需实体牌");
  return card.id;
}

function putCardInHand(
  state: GameState,
  playerId: string,
  cardId: PhysicalCardId,
  handIndex = 0,
): void {
  const currentOwner = Object.values(state.players).find((player) =>
    player.hand.includes(cardId),
  );
  if (currentOwner) {
    const target = state.players[playerId];
    const replacement = target.hand[handIndex];
    target.hand[handIndex] = cardId;
    currentOwner.hand[currentOwner.hand.indexOf(cardId)] = replacement;
    return;
  }

  const drawIndex = state.drawPile.indexOf(cardId);
  if (drawIndex < 0) throw new Error("测试牌不在可交换区域");
  const replacement = state.players[playerId].hand[handIndex];
  state.players[playerId].hand[handIndex] = cardId;
  state.drawPile[drawIndex] = replacement;
}

function moveCardToIntelligence(
  state: GameState,
  playerId: string,
  cardId: PhysicalCardId,
): void {
  const drawIndex = state.drawPile.indexOf(cardId);
  if (drawIndex >= 0) {
    state.drawPile.splice(drawIndex, 1);
  } else {
    const owner = Object.values(state.players).find((player) =>
      player.hand.includes(cardId),
    );
    if (!owner) throw new Error("测试情报牌不在可移动区域");
    owner.hand.splice(owner.hand.indexOf(cardId), 1);
  }
  state.players[playerId].intelligence.push(cardId);
}

describe("开始传递", () => {
  it("选择进入传递阶段后才将超过7张的手牌公开弃至7张", () => {
    const state = initializedWithActive(players, 30);
    while (state.players["甲"].hand.length < 8) {
      const cardId = state.drawPile.pop();
      if (!cardId) throw new Error("测试牌堆不足");
      state.players["甲"].hand.push(cardId);
    }
    const transmissionCard = cardIdWhere(
      (card) => card.transmission === "密电" && !card.circle,
    );
    putCardInHand(state, "甲", transmissionCard);
    const discardedCard = state.players["甲"].hand[1];

    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "ENTER_TRANSMISSION_PHASE",
    });
    expect(projectGameForPlayer(state, "甲").legalActions.some(
      (action) => action.type === "DISCARD_FOR_HAND_LIMIT",
    )).toBe(false);

    enterTransmissionPhase(state, "甲");

    expect(state.phase).toBe("discardingForTransmission");
    expect(projectGameForPlayer(state, "甲").legalActions).toHaveLength(8);

    discardForHandLimit(state, "甲", discardedCard);

    expect(state.players["甲"].hand).toHaveLength(7);
    expect(state.publicDiscard).toContain(discardedCard);
    const discarded = PHYSICAL_DECK.find((card) => card.id === discardedCard)!;
    expect(state.auditLog).toContain(
      `甲因手牌上限弃置一张牌：「${discarded.name}（${discarded.color} · ${discarded.transmission}）」`,
    );
    expect(
      projectGameForPlayer(state, "乙").publicDiscard.map((card) => card.id),
    ).toContain(discardedCard);
    expect(projectGameForPlayer(state, "甲").legalActions).not.toContainEqual({
      type: "DISCARD_FOR_HAND_LIMIT",
      cardId: discardedCard,
    });
    passAllReactions(state);
    expect(() => startTransmission(state, "甲", transmissionCard)).not.toThrow();
  });

  it("不带圈密电固定为顺时针", () => {
    const state = initializedWithActive(players, 1);
    const cardId = cardIdWhere(
      (card) => card.transmission === "密电" && !card.circle,
    );
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId);

    expect(state.transmission).toMatchObject({
      cardId,
      senderId: "甲",
      method: "密电",
      direction: "clockwise",
      intendedRecipientId: "乙",
    });
    expect(() => assertGameStateInvariants(state)).not.toThrow();
  });

  it("双人模式带圈情报无需选择方向并固定为顺时针", () => {
    const state = initializedWithActive(["甲", "乙"], 11);
    const cardId = state.drawPile.find((id) =>
      PHYSICAL_DECK.some(
        (card) => card.id === id && card.transmission === "密电" && card.circle,
      ),
    );
    if (!cardId) throw new Error("双人牌组缺少带圈密电");
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId);

    expect(state.transmission).toMatchObject({
      direction: "clockwise",
      intendedRecipientId: "乙",
    });
  });

  it("带圈情报选择逆时针后方向保持固定", () => {
    const state = initializedWithActive(players, 2);
    const cardId = cardIdWhere(
      (card) => card.transmission === "密电" && card.circle,
    );
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, { direction: "counterclockwise" });
    expect(state.transmission?.intendedRecipientId).toBe("戊");

    declineAfterReactions(state, "戊");
    expect(state.transmission).toMatchObject({
      direction: "counterclockwise",
      intendedRecipientId: "丁",
    });
  });

  it("直达被拒绝后返回发送者", () => {
    const state = initializedWithActive(players, 3);
    const cardId = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, { targetId: "丁" });
    declineAfterReactions(state, "丁");

    expect(state.transmission?.intendedRecipientId).toBe("甲");
    expect(() => declineAfterReactions(state, "甲")).toThrow(
      "返回发送者的情报必须接收或转移，不能再次拒绝",
    );
    expect(projectGameForPlayer(state, "甲").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
    ]);
    acceptIntelligence(state, "甲");
    expect(state.players["甲"].intelligence).toContain(cardId);
    expect(state.activePlayerId).toBe("乙");
  });

  it("密电绕回发送者后也必须接收或转移", () => {
    const state = initializedWithActive(["甲", "乙"], 31);
    const cardId = cardIdWhere(
      (card) =>
        card.transmission === "密电" &&
        !card.circle &&
        card.name !== "截获",
    );
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId);
    declineAfterReactions(state, "乙");
    expect(state.transmission?.intendedRecipientId).toBe("甲");
    expect(state.transmission?.returnedToSender).toBe(true);
    expect(() => declineAfterReactions(state, "甲")).toThrow(
      "返回发送者的情报必须接收或转移，不能再次拒绝",
    );
    expect(projectGameForPlayer(state, "甲").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
    ]);
  });

  it("任意传递牌要求发送者选择实际方式", () => {
    const state = initializedWithActive(players, 4);
    const cardId = cardIdWhere((card) => card.transmission === "任意");
    putCardInHand(state, "甲", cardId);

    expect(() => startTransmission(state, "甲", cardId)).toThrow(
      "必须选择一种传递方式",
    );
    startTransmission(state, "甲", cardId, {
      method: "文本",
      direction: "clockwise",
    });
    expect(state.transmission?.method).toBe("文本");
  });
});

describe("接收、死亡与胜利", () => {
  it("接收后将实体牌移入接收者情报区", () => {
    const state = initializedWithActive(players, 5);
    const cardId = cardIdWhere(
      (card) => card.transmission === "直达",
    );
    putCardInHand(state, "甲", cardId);
    startTransmission(state, "甲", cardId, { targetId: "乙" });

    acceptAfterReactions(state, "乙");

    expect(state.players["乙"].intelligence).toContain(cardId);
    const acceptedCard = PHYSICAL_DECK.find((card) => card.id === cardId)!;
    expect(state.auditLog).toContain(
      `乙接收情报：「${acceptedCard.name}（${acceptedCard.color} · ${acceptedCard.transmission}）」`,
    );
    expect(state.transmission).toBeUndefined();
    expect(state.phase).toBe("initialized");
    expect(state.activePlayerId).toBe("乙");
    expect(state.auditLog.at(-1)).toBe("乙回合开始并摸2张牌");
  });

  it("回合顺时针推进并跳过死亡玩家", () => {
    const state = initializedWithActive(players, 51);
    state.players["乙"].alive = false;
    const cardId = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", cardId);
    const nextHandSize = state.players["丙"].hand.length;

    startTransmission(state, "甲", cardId, { targetId: "丙" });
    acceptAfterReactions(state, "丙");

    expect(state.activePlayerId).toBe("丙");
    expect(state.players["丙"].hand).toHaveLength(nextHandSize + 2);
    expect(state.phase).toBe("initialized");
  });

  it("下一回合按旧当前玩家顺时针推进，而不是由接收者接手", () => {
    const state = initializedWithActive(players, 52);
    const cardId = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, { targetId: "丁" });
    acceptAfterReactions(state, "丁");

    expect(state.activePlayerId).toBe("乙");
  });

  it("死亡的当前接收者不能接收或回应情报", () => {
    const acceptingState = initializedWithActive(players, 53);
    const acceptCard = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(acceptingState, "甲", acceptCard);
    startTransmission(acceptingState, "甲", acceptCard, { targetId: "乙" });
    passAllReactions(acceptingState);
    acceptingState.players["乙"].alive = false;
    expect(() => acceptIntelligence(acceptingState, "乙")).toThrow(
      "死亡玩家不能接收情报",
    );

    const decliningState = initializedWithActive(players, 54);
    const declineCard = cardIdWhere(
      (card) => card.transmission === "直达" && card.id !== acceptCard,
    );
    putCardInHand(decliningState, "甲", declineCard);
    startTransmission(decliningState, "甲", declineCard, { targetId: "乙" });
    passAllReactions(decliningState);
    decliningState.players["乙"].alive = false;
    expect(() => declineIntelligence(decliningState, "乙")).toThrow(
      "死亡玩家不能回应情报",
    );
  });

  it("第三张黑色情报先导致特工死亡，不判定六张胜利", () => {
    const state = initializedWithActive([...players, "己"], 6);
    const receiverId = state.seatOrder.find(
      (id) => id !== "甲" && state.players[id].faction === "特工",
    );
    if (!receiverId) throw new Error("未找到非当前玩家的特工");
    const used: PhysicalCardId[] = [];
    for (let index = 0; index < 2; index += 1) {
      const id = cardIdWhere(
        (card) => card.color === "黑" && card.name !== "公开文本",
        used,
      );
      used.push(id);
      moveCardToIntelligence(state, receiverId, id);
    }
    for (let index = 0; index < 3; index += 1) {
      const id = cardIdWhere(
        (card) => card.color !== "黑" && card.name !== "公开文本",
        used,
      );
      used.push(id);
      moveCardToIntelligence(state, receiverId, id);
    }
    const fatalCard = cardIdWhere(
      (card) =>
        card.color === "黑" &&
        card.transmission === "直达",
      used,
    );
    putCardInHand(state, "甲", fatalCard);

    startTransmission(state, "甲", fatalCard, { targetId: receiverId });
    acceptAfterReactions(state, receiverId);

    expect(state.players[receiverId].alive).toBe(false);
    expect(state.players[receiverId].intelligence).toHaveLength(6);
    const acceptedCard = PHYSICAL_DECK.find((card) => card.id === fatalCard)!;
    expect(state.auditLog).toContain(
      `${receiverId}接收情报「${acceptedCard.name}（${acceptedCard.color} · ${acceptedCard.transmission}）」后死亡，阵营公开为特工`,
    );
    expect(state.winner).toBeUndefined();
  });

  it("接收第三张黑色情报死亡后检查阵营消灭胜利", () => {
    const state = initializedWithActive(players, 61);
    const survivingFaction = "军情";
    const survivors = state.seatOrder.filter(
      (id) => state.players[id].faction === survivingFaction,
    );
    const receiverId = state.seatOrder.find(
      (id) => state.players[id].faction !== survivingFaction,
    );
    if (survivors.length < 2 || !receiverId) throw new Error("测试阵营分配无效");
    state.activePlayerId = survivors[0];
    for (const id of state.seatOrder) {
      if (!survivors.includes(id) && id !== receiverId) {
        state.players[id].alive = false;
        state.players[id].factionRevealed = true;
      }
    }
    const used: PhysicalCardId[] = [];
    for (let index = 0; index < 2; index += 1) {
      const black = cardIdWhere((card) => card.color === "黑", used);
      used.push(black);
      moveCardToIntelligence(state, receiverId, black);
    }
    const fatalCard = cardIdWhere(
      (card) => card.color === "黑" && card.transmission === "直达",
      used,
    );
    putCardInHand(state, state.activePlayerId, fatalCard);

    startTransmission(state, state.activePlayerId, fatalCard, { targetId: receiverId });
    acceptAfterReactions(state, receiverId);

    expect(state.winner).toEqual({ kind: "faction", faction: survivingFaction });
    expect(state.phase).toBe("gameOver");
  });

  it("红蓝机密文件计入军情蓝色胜利", () => {
    const state = initializedWithActive(players, 7);
    const receiverId = state.seatOrder.find(
      (id) => id !== "甲" && state.players[id].faction === "军情",
    );
    if (!receiverId) throw new Error("未找到非当前玩家的军情玩家");
    const blueCards = PHYSICAL_DECK.filter(
      (card) => card.color === "蓝" && card.name !== "公开文本",
    ).slice(0, 2);
    for (const card of blueCards) {
      moveCardToIntelligence(state, receiverId, card.id);
    }
    const dualCard = cardIdWhere(
      (card) => card.name === "机密文件",
      blueCards.map((card) => card.id),
    );
    putCardInHand(state, "甲", dualCard);

    startTransmission(state, "甲", dualCard, { targetId: receiverId });
    acceptAfterReactions(state, receiverId);

    expect(state.winner).toEqual({ kind: "faction", faction: "军情" });
    expect(state.phase).toBe("gameOver");
    expect(state.auditLog).toContain("甲的回合结束");
  });
});

describe("转移", () => {
  it("直达返回发送者后可弃置转移并选择新的存活接收者", () => {
    const state = initializedWithActive(players, 61);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "甲", transferCard, 1);

    startTransmission(state, "甲", directCard, { targetId: "乙" });
    declineAfterReactions(state, "乙");
    passUntilReactionTurn(state, "甲");

    const actions = projectGameForPlayer(state, "甲").legalActions;
    expect(actions).toContainEqual({ type: "PASS_REACTION" });
    expect(actions).toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: transferCard,
      targetId: "丁",
    });
    expect(actions).not.toContainEqual({ type: "DECLINE_INTELLIGENCE" });

    playTransfer(state, "甲", transferCard, "丁");

    expect(state.transmission?.pendingTransfer?.targetId).toBe("丁");
    expect(state.publicDiscard).toContain(transferCard);
    expect(projectGameForPlayer(state, "戊").legalActions).toContainEqual({
      type: "PASS_REACTION",
    });
    expect(projectGameForPlayer(state, "丁").legalActions).toEqual([]);
    expect(() => passReaction(state, "丁")).toThrow("尚未轮到该玩家响应");

    expect(state.reactionWindow?.responderOrder).toEqual([
      "戊",
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
    passAllReactions(state);

    expect(state.transmission?.intendedRecipientId).toBe("丁");
    passAllReactions(state);
    expect(projectGameForPlayer(state, "丁").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
    ]);
    expect(() => declineIntelligence(state, "丁")).toThrow(
      "转移后的接收者必须接收情报，不能拒绝",
    );
    acceptIntelligence(state, "丁");
    expect(state.transmission).toBeUndefined();
  });

  it("非原发送者也可在自己即将接收未锁定情报时使用转移", () => {
    const state = initializedWithActive(players, 62);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    const chainedTransfer = cardIdWhere((card) => card.name === "转移", [directCard, transferCard]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "乙", transferCard, 0);
    putCardInHand(state, "丁", chainedTransfer, 0);
    startTransmission(state, "甲", directCard, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    passUntilReactionTurn(state, "乙");

    expect(projectGameForPlayer(state, "乙").legalActions).toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: transferCard,
      targetId: "丁",
    });
    playTransfer(state, "乙", transferCard, "丁");
    finishCurrentReactionWindow(state);
    expect(state.transmission).toMatchObject({
      intendedRecipientId: "丁",
      receiptStage: "reactions",
      lockOfferUsed: true,
      transferredRecipientCommitted: true,
    });
    passUntilReactionTurn(state, "丁");
    expect(projectGameForPlayer(state, "丁").legalActions).toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: chainedTransfer,
      targetId: "戊",
    });
  });

  it("非原发送者可将未锁定情报转移回原发送者，且原发送者必须接收", () => {
    const state = initializedWithActive(players, 620);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "乙", transferCard, 0);

    startTransmission(state, "甲", directCard, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    passUntilReactionTurn(state, "乙");

    expect(projectGameForPlayer(state, "乙").legalActions).toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: transferCard,
      targetId: "甲",
    });
    playTransfer(state, "乙", transferCard, "甲");
    finishCurrentReactionWindow(state);

    expect(state.transmission).toMatchObject({
      intendedRecipientId: "甲",
      returnedToSender: false,
      transferredRecipientCommitted: true,
    });
    passAllReactions(state);
    expect(projectGameForPlayer(state, "甲").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
    ]);
    expect(() => declineIntelligence(state, "甲")).toThrow(
      "转移后的接收者必须接收情报，不能拒绝",
    );
    acceptIntelligence(state, "甲");
    expect(state.transmission).toBeUndefined();
  });

  it("锁定后的当前接收者不能使用转移", () => {
    const state = initializedWithActive(players, 621);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    const lockCard = cardIdWhere((card) => card.name === "锁定", [directCard, transferCard]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "甲", lockCard, 1);
    putCardInHand(state, "乙", transferCard, 0);
    startTransmission(state, "甲", directCard, { targetId: "乙" });
    playLock(state, "甲", lockCard);
    passUntilReactionTurn(state, "乙");

    expect(projectGameForPlayer(state, "乙").legalActions).not.toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: transferCard,
      targetId: "丁",
    });
    expect(() => playTransfer(state, "乙", transferCard, "丁")).toThrow(
      "只有未被锁定情报的当前接收者可以使用转移",
    );
  });

  it("返回发送者的密电也可以使用转移", () => {
    const state = initializedWithActive(["甲", "乙"], 63);
    const secretCard = cardIdWhere(
      (card) =>
        card.transmission === "密电" &&
        !card.circle &&
        card.name !== "截获",
    );
    const transferCard = cardIdWhere((card) => card.name === "转移", [secretCard]);
    putCardInHand(state, "甲", secretCard, 0);
    putCardInHand(state, "甲", transferCard, 1);

    startTransmission(state, "甲", secretCard);
    declineAfterReactions(state, "乙");
    passUntilReactionTurn(state, "甲");
    playTransfer(state, "甲", transferCard, "乙");
    passAllReactions(state);

    expect(state.transmission).toMatchObject({
      method: "密电",
      direction: "clockwise",
      intendedRecipientId: "乙",
      returnedToSender: false,
    });
  });

  it("离间可改换待结算转移的目标并从新目标重开顺时针窗口", () => {
    const state = initializedWithActive(players, 65);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    const separationCard = cardIdWhere((card) => card.name === "离间", [
      directCard,
      transferCard,
    ]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "甲", transferCard, 1);
    putCardInHand(state, "丁", separationCard, 0);
    startTransmission(state, "甲", directCard, { targetId: "乙" });
    declineAfterReactions(state, "乙");
    passUntilReactionTurn(state, "甲");
    playTransfer(state, "甲", transferCard, "丁");

    passUntilReactionTurn(state, "丁");
    expect(projectGameForPlayer(state, "丁").legalActions).toContainEqual({
      type: "PLAY_SEPARATION",
      cardId: separationCard,
      targetId: "乙",
    });
    playSeparationOnTransfer(state, "丁", separationCard, "乙");

    expect(state.transmission?.pendingTransfer?.targetId).toBe("乙");
    expect(state.reactionWindow).toMatchObject({
      affectedPlayerId: "乙",
      responderOrder: ["丙", "丁", "戊", "甲", "乙"],
      nextResponderIndex: 0,
    });
    expect(state.publicDiscard).toContain(separationCard);
    passAllReactions(state);
    expect(state.transmission?.intendedRecipientId).toBe("乙");
  });

  it("拒绝损坏的响应位置和转移目标关联", () => {
    const state = initializedWithActive(players, 66);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "甲", transferCard, 1);
    startTransmission(state, "甲", directCard, { targetId: "乙" });
    declineAfterReactions(state, "乙");
    passUntilReactionTurn(state, "甲");
    playTransfer(state, "甲", transferCard, "丁");

    state.reactionWindow!.nextResponderIndex = 0.5;
    expect(() => assertGameStateInvariants(state)).toThrow(
      "响应窗口的当前响应位置无效",
    );
    state.reactionWindow!.nextResponderIndex = 0;
    state.reactionWindow!.affectedPlayerId = "乙";
    expect(() => assertGameStateInvariants(state)).toThrow(
      "响应顺序必须从目标的下一名存活玩家开始，并让目标最后响应",
    );
  });

  it("传递发送者必须始终是当前行动玩家", () => {
    const state = initializedWithActive(players, 64);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", directCard);
    startTransmission(state, "甲", directCard, { targetId: "乙" });

    state.activePlayerId = "丙";
    expect(() => assertGameStateInvariants(state)).toThrow(
      "传递发送者必须是当前行动玩家",
    );
  });
});

describe("发送者锁定与目标最后响应", () => {
  it("先由发送者选择锁定，放弃后才按目标后一席开始响应", () => {
    const state = initializedWithActive(players, 71);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", intelligence);

    startTransmission(state, "甲", intelligence, { targetId: "丁" });

    expect(state.transmission?.receiptStage).toBe("lockOffer");
    expect(state.reactionWindow).toBeUndefined();
    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "PASS_LOCK",
    });
    passLockOpportunity(state, "甲");
    expect(state.reactionWindow?.responderOrder).toEqual([
      "戊",
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
    passReaction(state, "戊");
    expect(state.auditLog.some((entry) => entry.includes("放弃响应"))).toBe(false);
  });

  it("锁定可被识破，识破又可被另一名玩家识破并恢复锁定", () => {
    const state = initializedWithActive(players, 72);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const lock = cardIdWhere((card) => card.name === "锁定", [intelligence]);
    const counter = cardIdWhere((card) => card.name === "识破", [intelligence, lock]);
    const counterCounter = cardIdWhere((card) => card.name === "识破", [
      intelligence,
      lock,
      counter,
    ]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "甲", lock, 1);
    putCardInHand(state, "丙", counter, 0);
    putCardInHand(state, "乙", counterCounter, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    playLock(state, "甲", lock);
    playCounter(state, "丙", counter, state.interactionStack.at(-1)!.id);
    expect(state.transmission?.locked).toBe(false);
    playCounter(state, "乙", counterCounter, state.interactionStack.at(-1)!.id);
    expect(state.transmission?.locked).toBe(true);
    expect(projectGameForPlayer(state, "丁").responseStack).toEqual([
      expect.objectContaining({ kind: "card", sourcePlayerId: "甲", cardName: "锁定" }),
      expect.objectContaining({ kind: "counter", sourcePlayerId: "丙", cardName: "识破" }),
      expect.objectContaining({ kind: "counter", sourcePlayerId: "乙", cardName: "识破" }),
    ]);
    passAllReactions(state);
    expect(projectGameForPlayer(state, "乙").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
    ]);
  });

  it("不能识破自己的卡牌行动", () => {
    const state = initializedWithActive(players, 73);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const intercept = cardIdWhere((card) => card.name === "截获", [intelligence]);
    const counter = cardIdWhere((card) => card.name === "识破", [intelligence, intercept]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", intercept, 0);
    putCardInHand(state, "丙", counter, 1);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playIntercept(state, "丙", intercept);
    passUntilReactionTurn(state, "丙");
    expect(() =>
      playCounter(state, "丙", counter, state.interactionStack.at(-1)!.id),
    ).toThrow("不能使用识破反制自己的卡牌行动");
  });
});

describe("截获、掉包、调虎离山与转移接收", () => {
  it("最终截获者在响应结束后自动接收", () => {
    const state = initializedWithActive(players, 74);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const intercept = cardIdWhere((card) => card.name === "截获", [intelligence]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", intercept, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playIntercept(state, "丙", intercept);
    passAllReactions(state);

    expect(state.transmission).toBeUndefined();
    expect(state.players["丙"].intelligence).toContain(intelligence);
  });

  it("截获者已承诺接收，不能再使用转移", () => {
    const state = initializedWithActive(players, 740);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const intercept = cardIdWhere((card) => card.name === "截获", [intelligence]);
    const transfer = cardIdWhere((card) => card.name === "转移", [intelligence, intercept]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", intercept, 0);
    putCardInHand(state, "丙", transfer, 1);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playIntercept(state, "丙", intercept);
    passUntilReactionTurn(state, "丙");

    expect(projectGameForPlayer(state, "丙").legalActions).not.toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: transfer,
      targetId: "丁",
    });
    expect(() => playTransfer(state, "丙", transfer, "丁")).toThrow(
      "截获者已承诺接收情报，不能使用转移",
    );
  });

  it("截获后仍可掉包，替换情报由最终截获者强制接收", () => {
    const state = initializedWithActive(players, 741);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const intercept = cardIdWhere((card) => card.name === "截获", [intelligence]);
    const swap = cardIdWhere((card) => card.name === "掉包", [intelligence, intercept]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", intercept, 0);
    putCardInHand(state, "丁", swap, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playIntercept(state, "丙", intercept);
    expect(projectGameForPlayer(state, "丁").legalActions).toContainEqual({
      type: "PLAY_SWAP",
      cardId: swap,
    });
    playSwap(state, "丁", swap);
    finishCurrentReactionWindow(state);

    expect(state.transmission).toMatchObject({
      cardId: swap,
      intendedRecipientId: "丙",
      interceptorCommitted: true,
    });
    passAllReactions(state);
    expect(state.transmission).toBeUndefined();
    expect(state.players["丙"].intelligence).toContain(swap);
    expect(state.publicDiscard).toContain(intelligence);
    const originalCard = PHYSICAL_DECK.find((card) => card.id === intelligence)!;
    const replacementCard = PHYSICAL_DECK.find((card) => card.id === swap)!;
    expect(state.auditLog).toContain(
      `掉包结算：原情报「${originalCard.name}（${originalCard.color} · ${originalCard.transmission}）」公开弃置；替换牌「${replacementCard.name}（${replacementCard.color} · ${replacementCard.transmission}）」正面朝上`,
    );
  });

  it("掉包结算后仍可再次掉包", () => {
    const state = initializedWithActive(players, 75);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const firstSwap = cardIdWhere((card) => card.name === "掉包", [intelligence]);
    const secondSwap = cardIdWhere((card) => card.name === "掉包", [
      intelligence,
      firstSwap,
    ]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", firstSwap, 0);
    putCardInHand(state, "丁", secondSwap, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playSwap(state, "丙", firstSwap);
    finishCurrentReactionWindow(state);
    expect(state.transmission?.cardId).toBe(firstSwap);
    passUntilReactionTurn(state, "丁");
    playSwap(state, "丁", secondSwap);
    finishCurrentReactionWindow(state);
    expect(state.transmission?.cardId).toBe(secondSwap);
    expect(state.publicDiscard).toContain(firstSwap);
  });

  it("调虎离山强制普通接收者拒绝，但锁定或截获后不能使用", () => {
    const state = initializedWithActive(players, 76);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const lure = cardIdWhere((card) => card.name === "调虎离山", [intelligence]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", lure, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playLure(state, "丙", lure);
    finishCurrentReactionWindow(state);
    expect(state.transmission).toMatchObject({
      intendedRecipientId: "甲",
      returnedToSender: true,
      receiptStage: "reactions",
      lockOfferUsed: true,
    });
  });

  it("调虎离山被识破后重新开始完整情报响应，原出牌者可再次使用调虎离山", () => {
    const state = initializedWithActive(players, 761);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const firstLure = cardIdWhere((card) => card.name === "调虎离山", [
      intelligence,
    ]);
    const counter = cardIdWhere((card) => card.name === "识破", [
      intelligence,
      firstLure,
    ]);
    const secondLure = cardIdWhere((card) => card.name === "调虎离山", [
      intelligence,
      firstLure,
      counter,
    ]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "丙", firstLure, 0);
    putCardInHand(state, "丙", secondLure, 1);
    putCardInHand(state, "丁", counter, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    playLure(state, "丙", firstLure);
    passReaction(state, "丙");
    playCounter(
      state,
      "丁",
      counter,
      state.interactionStack.at(-1)!.id,
    );
    finishCurrentReactionWindow(state);

    expect(state.reactionWindow).toMatchObject({
      kind: "intelligence",
      affectedPlayerId: "乙",
      responderOrder: ["丙", "丁", "戊", "甲", "乙"],
      nextResponderIndex: 0,
    });
    expect(projectGameForPlayer(state, "丙").legalActions).toContainEqual({
      type: "PLAY_LURE",
      cardId: secondLure,
    });

    playLure(state, "丙", secondLure);
    expect(state.transmission?.pendingLure).toMatchObject({
      sourceCardId: secondLure,
      targetId: "乙",
    });
  });

  it("锁定或截获承诺存在时禁止调虎离山", () => {
    const lockedState = initializedWithActive(players, 78);
    const lockedIntelligence = cardIdWhere((card) => card.transmission === "直达");
    const lock = cardIdWhere((card) => card.name === "锁定", [lockedIntelligence]);
    const lockedLure = cardIdWhere((card) => card.name === "调虎离山", [
      lockedIntelligence,
      lock,
    ]);
    putCardInHand(lockedState, "甲", lockedIntelligence, 0);
    putCardInHand(lockedState, "甲", lock, 1);
    putCardInHand(lockedState, "丙", lockedLure, 0);
    startTransmission(lockedState, "甲", lockedIntelligence, { targetId: "乙" });
    playLock(lockedState, "甲", lock);
    expect(() => playLure(lockedState, "丙", lockedLure)).toThrow(
      "当前接收状态不能使用调虎离山",
    );

    const interceptedState = initializedWithActive(players, 79);
    const interceptedIntelligence = cardIdWhere(
      (card) => card.transmission === "直达" && card.id !== lockedIntelligence,
    );
    const intercept = cardIdWhere((card) => card.name === "截获", [
      interceptedIntelligence,
    ]);
    const interceptedLure = cardIdWhere((card) => card.name === "调虎离山", [
      interceptedIntelligence,
      intercept,
    ]);
    putCardInHand(interceptedState, "甲", interceptedIntelligence, 0);
    putCardInHand(interceptedState, "丙", intercept, 0);
    putCardInHand(interceptedState, "丁", interceptedLure, 0);
    startTransmission(interceptedState, "甲", interceptedIntelligence, {
      targetId: "乙",
    });
    passLockOpportunity(interceptedState, "甲");
    playIntercept(interceptedState, "丙", intercept);
    expect(() => playLure(interceptedState, "丁", interceptedLure)).toThrow(
      "当前接收状态不能使用调虎离山",
    );
  });

  it("转移目标可破译且必须接收，掉包后仍保留该承诺", () => {
    const state = initializedWithActive(players, 77);
    const intelligence = cardIdWhere((card) => card.transmission === "直达");
    const transfer = cardIdWhere((card) => card.name === "转移", [intelligence]);
    const swap = cardIdWhere((card) => card.name === "掉包", [intelligence, transfer]);
    const decrypt = cardIdWhere((card) => card.name === "破译", [
      intelligence,
      transfer,
      swap,
    ]);
    putCardInHand(state, "甲", intelligence, 0);
    putCardInHand(state, "甲", transfer, 1);
    putCardInHand(state, "戊", swap, 0);
    putCardInHand(state, "丁", decrypt, 0);

    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    declineAfterReactions(state, "乙");
    passUntilReactionTurn(state, "甲");
    playTransfer(state, "甲", transfer, "丁");
    finishCurrentReactionWindow(state);

    expect(state.transmission).toMatchObject({
      intendedRecipientId: "丁",
      receiptStage: "reactions",
      lockOfferUsed: true,
      locked: false,
    });
    expect(projectGameForPlayer(state, "甲").legalActions).not.toContainEqual({
      type: "PASS_LOCK",
    });
    expect(projectGameForPlayer(state, "戊").legalActions).toContainEqual({
      type: "PLAY_SWAP",
      cardId: swap,
    });
    playSwap(state, "戊", swap);
    finishCurrentReactionWindow(state);

    expect(state.transmission?.transferredRecipientCommitted).toBe(true);
    passUntilReactionTurn(state, "丁");
    expect(projectGameForPlayer(state, "丁").legalActions).toContainEqual({
      type: "PLAY_DECRYPT",
      cardId: decrypt,
    });
    playDecrypt(state, "丁", decrypt);
    finishCurrentReactionWindow(state);

    expect(projectGameForPlayer(state, "丁").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
    ]);
    expect(() => declineIntelligence(state, "丁")).toThrow(
      "转移后的接收者必须接收情报，不能拒绝",
    );
  });
});

describe("待传情报投影", () => {
  it("密电仅向发送者暴露实体牌，接收者只看到合法回应", () => {
    const state = initializedWithActive(players, 8);
    const cardId = cardIdWhere(
      (card) => card.transmission === "密电" && !card.circle,
    );
    putCardInHand(state, "甲", cardId);
    startTransmission(state, "甲", cardId);

    const senderView = projectGameForPlayer(state, "甲");
    const receiverView = projectGameForPlayer(state, "乙");
    const observerView = projectGameForPlayer(state, "丙");

    expect(senderView.transmission?.card?.id).toBe(cardId);
    expect(receiverView.transmission?.card).toBeUndefined();
    expect(senderView.legalActions).toContainEqual({ type: "PASS_LOCK" });
    expect(receiverView.legalActions).toEqual([]);
    expect(observerView.legalActions).toEqual([]);
    passAllReactions(state);
    expect(projectGameForPlayer(state, "乙").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
      { type: "DECLINE_INTELLIGENCE" },
    ]);
    expect(JSON.stringify(receiverView)).not.toContain(cardId);
  });

  it("文本情报向所有玩家公开实体牌", () => {
    const state = initializedWithActive(players, 9);
    const cardId = cardIdWhere(
      (card) => card.transmission === "文本" && !card.circle,
    );
    putCardInHand(state, "甲", cardId);
    startTransmission(state, "甲", cardId);

    expect(projectGameForPlayer(state, "丙").transmission?.card?.id).toBe(cardId);
  });

  it("公开文本在响应结束后开放接收并进入原子接收效果", () => {
    const state = initializedWithActive(players, 11);
    const cardId = cardIdWhere((card) => card.name === "公开文本");
    const card = PHYSICAL_DECK.find((candidate) => candidate.id === cardId);
    if (!card) throw new Error("公开文本不存在");
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, {
      direction: card.circle ? "clockwise" : undefined,
    });
    const recipientId = state.transmission?.intendedRecipientId;
    if (!recipientId) throw new Error("没有当前接收者");

    expect(projectGameForPlayer(state, recipientId).legalActions).toEqual([]);
    passAllReactions(state);
    expect(projectGameForPlayer(state, recipientId).legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
      { type: "DECLINE_INTELLIGENCE" },
    ]);
  });

  it("投影卡牌与胜者对象不共享权威状态引用", () => {
    const state = initializedWithActive(players, 10);
    const projection = projectGameForPlayer(state, "甲");
    const originalColor = projection.own.hand[0].color;

    projection.own.hand[0].color = originalColor === "黑" ? "红" : "黑";

    const freshProjection = projectGameForPlayer(state, "甲");
    expect(freshProjection.own.hand[0].color).toBe(originalColor);
  });
});
