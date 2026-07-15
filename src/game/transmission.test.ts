import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCardId } from "./cards";
import {
  acceptIntelligence,
  assertGameStateInvariants,
  discardForHandLimit,
  declineIntelligence,
  initializeGame,
  playTransfer,
  projectGameForPlayer,
  resolveTransfer,
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
  it("手牌超过7张时必须先公开弃至7张", () => {
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

    expect(() =>
      startTransmission(state, "甲", transmissionCard),
    ).toThrow("开始传递前必须将手牌弃至7张");
    expect(projectGameForPlayer(state, "甲").legalActions).toHaveLength(8);

    discardForHandLimit(state, "甲", discardedCard);

    expect(state.players["甲"].hand).toHaveLength(7);
    expect(state.publicDiscard).toContain(discardedCard);
    expect(
      projectGameForPlayer(state, "乙").publicDiscard.map((card) => card.id),
    ).toContain(discardedCard);
    expect(projectGameForPlayer(state, "甲").legalActions).toEqual([]);
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

  it("带圈情报选择逆时针后方向保持固定", () => {
    const state = initializedWithActive(players, 2);
    const cardId = cardIdWhere(
      (card) => card.transmission === "密电" && card.circle,
    );
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, { direction: "counterclockwise" });
    expect(state.transmission?.intendedRecipientId).toBe("戊");

    declineIntelligence(state, "戊");
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
    declineIntelligence(state, "丁");

    expect(state.transmission?.intendedRecipientId).toBe("甲");
    expect(() => declineIntelligence(state, "甲")).toThrow(
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
    declineIntelligence(state, "乙");
    expect(state.transmission?.intendedRecipientId).toBe("甲");
    expect(state.transmission?.returnedToSender).toBe(true);
    expect(() => declineIntelligence(state, "甲")).toThrow(
      "返回发送者的情报必须接收或转移，不能再次拒绝",
    );
    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "ACCEPT_INTELLIGENCE",
    });
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

    acceptIntelligence(state, "乙");

    expect(state.players["乙"].intelligence).toContain(cardId);
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
    acceptIntelligence(state, "丙");

    expect(state.activePlayerId).toBe("丙");
    expect(state.players["丙"].hand).toHaveLength(nextHandSize + 2);
    expect(state.phase).toBe("initialized");
  });

  it("下一回合按旧当前玩家顺时针推进，而不是由接收者接手", () => {
    const state = initializedWithActive(players, 52);
    const cardId = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, { targetId: "丁" });
    acceptIntelligence(state, "丁");

    expect(state.activePlayerId).toBe("乙");
  });

  it("死亡的当前接收者不能接收或回应情报", () => {
    const acceptingState = initializedWithActive(players, 53);
    const acceptCard = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(acceptingState, "甲", acceptCard);
    startTransmission(acceptingState, "甲", acceptCard, { targetId: "乙" });
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
    acceptIntelligence(state, receiverId);

    expect(state.players[receiverId].alive).toBe(false);
    expect(state.players[receiverId].intelligence).toHaveLength(6);
    expect(state.winner).toBeUndefined();
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
    acceptIntelligence(state, receiverId);

    expect(state.winner).toEqual({ kind: "faction", faction: "军情" });
    expect(state.phase).toBe("victoryPending");
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
    declineIntelligence(state, "乙");

    const actions = projectGameForPlayer(state, "甲").legalActions;
    expect(actions).toContainEqual({ type: "ACCEPT_INTELLIGENCE" });
    expect(actions).toContainEqual({
      type: "PLAY_TRANSFER",
      cardId: transferCard,
      targetId: "丁",
    });
    expect(actions).not.toContainEqual({ type: "DECLINE_INTELLIGENCE" });

    playTransfer(state, "甲", transferCard, "丁");

    expect(state.transmission?.pendingTransfer?.targetId).toBe("丁");
    expect(state.publicDiscard).toContain(transferCard);
    expect(projectGameForPlayer(state, "丁").legalActions).toEqual([]);

    resolveTransfer(state);

    expect(state.transmission?.intendedRecipientId).toBe("丁");
    expect(projectGameForPlayer(state, "丁").legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
      { type: "DECLINE_INTELLIGENCE" },
    ]);
    declineIntelligence(state, "丁");
    expect(state.transmission).toMatchObject({
      intendedRecipientId: "甲",
      returnedToSender: true,
    });
    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "ACCEPT_INTELLIGENCE",
    });
  });

  it("直达尚未返回时不能使用转移", () => {
    const state = initializedWithActive(players, 62);
    const directCard = cardIdWhere((card) => card.transmission === "直达");
    const transferCard = cardIdWhere((card) => card.name === "转移", [directCard]);
    putCardInHand(state, "甲", directCard, 0);
    putCardInHand(state, "甲", transferCard, 1);
    startTransmission(state, "甲", directCard, { targetId: "乙" });

    expect(() => playTransfer(state, "甲", transferCard, "丁")).toThrow(
      "只有情报返回时的当前发送者可以使用转移",
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
    declineIntelligence(state, "乙");
    playTransfer(state, "甲", transferCard, "乙");
    resolveTransfer(state);

    expect(state.transmission).toMatchObject({
      method: "密电",
      direction: "clockwise",
      intendedRecipientId: "乙",
      returnedToSender: false,
    });
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
    expect(receiverView.legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
      { type: "DECLINE_INTELLIGENCE" },
    ]);
    expect(observerView.legalActions).toEqual([]);
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

  it("不会把尚未实现的公开文本接收动作标记为合法", () => {
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

    expect(projectGameForPlayer(state, recipientId).legalActions).toEqual([
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
