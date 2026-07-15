import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCardId } from "./cards";
import {
  acceptIntelligence,
  assertGameStateInvariants,
  declineIntelligence,
  initializeGame,
  projectGameForPlayer,
  startTransmission,
  type GameState,
} from "./engine";

const players = ["甲", "乙", "丙", "丁", "戊"] as const;

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

function putCardInHand(state: GameState, playerId: string, cardId: PhysicalCardId): void {
  const currentOwner = Object.values(state.players).find((player) =>
    player.hand.includes(cardId),
  );
  if (currentOwner) {
    const target = state.players[playerId];
    const replacement = target.hand[0];
    target.hand[0] = cardId;
    currentOwner.hand[currentOwner.hand.indexOf(cardId)] = replacement;
    return;
  }

  const drawIndex = state.drawPile.indexOf(cardId);
  if (drawIndex < 0) throw new Error("测试牌不在可交换区域");
  const replacement = state.players[playerId].hand[0];
  state.players[playerId].hand[0] = cardId;
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
  it("不带圈密电固定为顺时针", () => {
    const state = initializeGame(players, 1);
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
    const state = initializeGame(players, 2);
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
    const state = initializeGame(players, 3);
    const cardId = cardIdWhere((card) => card.transmission === "直达");
    putCardInHand(state, "甲", cardId);

    startTransmission(state, "甲", cardId, { targetId: "丁" });
    declineIntelligence(state, "丁");

    expect(state.transmission?.intendedRecipientId).toBe("甲");
    expect(() => declineIntelligence(state, "甲")).toThrow(
      "情报返回发送者后的处理规则尚未确认",
    );
    expect(projectGameForPlayer(state, "甲").legalActions).toEqual([]);
  });

  it("密电绕回发送者后仍可沿固定路线继续", () => {
    const state = initializeGame(["甲", "乙"], 31);
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
    declineIntelligence(state, "甲");
    expect(state.transmission?.intendedRecipientId).toBe("乙");
  });

  it("任意传递牌要求发送者选择实际方式", () => {
    const state = initializeGame(players, 4);
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
    const state = initializeGame(players, 5);
    const cardId = cardIdWhere(
      (card) => card.transmission === "直达",
    );
    putCardInHand(state, "甲", cardId);
    startTransmission(state, "甲", cardId, { targetId: "乙" });

    acceptIntelligence(state, "乙");

    expect(state.players["乙"].intelligence).toContain(cardId);
    expect(state.transmission).toBeUndefined();
    expect(state.phase).toBe("awaitingTurnEnd");
  });

  it("第三张黑色情报先导致特工死亡，不判定六张胜利", () => {
    const state = initializeGame([...players, "己"], 6);
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
    const state = initializeGame(players, 7);
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
  });
});

describe("待传情报投影", () => {
  it("密电仅向发送者暴露实体牌，接收者只看到合法回应", () => {
    const state = initializeGame(players, 8);
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
    const state = initializeGame(players, 9);
    const cardId = cardIdWhere(
      (card) => card.transmission === "文本" && !card.circle,
    );
    putCardInHand(state, "甲", cardId);
    startTransmission(state, "甲", cardId);

    expect(projectGameForPlayer(state, "丙").transmission?.card?.id).toBe(cardId);
  });

  it("不会把尚未实现的公开文本接收动作标记为合法", () => {
    const state = initializeGame(players, 11);
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
    const state = initializeGame(players, 10);
    const projection = projectGameForPlayer(state, "甲");
    const originalColor = projection.own.hand[0].color;

    projection.own.hand[0].color = originalColor === "黑" ? "红" : "黑";

    const freshProjection = projectGameForPlayer(state, "甲");
    expect(freshProjection.own.hand[0].color).toBe(originalColor);
  });
});
