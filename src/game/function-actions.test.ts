import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCardId } from "./cards";
import {
  chooseDangerousIntelligenceDiscard,
  initializeGame,
  passReaction,
  playConfidentialFile,
  playCounter,
  playDangerousIntelligence,
  playPublicText,
  playReinforcement,
  playSeparationOnFunction,
  projectGameForPlayer,
  type GameState,
} from "./engine";

const players = ["甲", "乙", "丙", "丁", "戊"] as const;

function game(seed = 1): GameState {
  const state = initializeGame(players, seed);
  state.activePlayerId = "甲";
  return state;
}

function cardId(
  name: (typeof PHYSICAL_DECK)[number]["name"],
  excluded: readonly PhysicalCardId[] = [],
): PhysicalCardId {
  const card = PHYSICAL_DECK.find(
    (candidate) => candidate.name === name && !excluded.includes(candidate.id),
  );
  if (!card) throw new Error(`找不到测试牌：${name}`);
  return card.id;
}

function cardIdByColor(
  color: (typeof PHYSICAL_DECK)[number]["color"],
  excluded: readonly PhysicalCardId[] = [],
): PhysicalCardId {
  const card = PHYSICAL_DECK.find(
    (candidate) => candidate.color === color && !excluded.includes(candidate.id),
  );
  if (!card) throw new Error(`找不到测试颜色：${color}`);
  return card.id;
}

function putInHand(
  state: GameState,
  playerId: string,
  wanted: PhysicalCardId,
  index = 0,
): void {
  const target = state.players[playerId];
  if (target.hand[index] === wanted) return;
  const replacement = target.hand[index];
  const owner = Object.values(state.players).find((player) =>
    player.hand.includes(wanted),
  );
  if (owner) {
    const ownerIndex = owner.hand.indexOf(wanted);
    target.hand[index] = wanted;
    owner.hand[ownerIndex] = replacement;
    return;
  }
  const drawIndex = state.drawPile.indexOf(wanted);
  if (drawIndex < 0) throw new Error("测试牌不在手牌或牌库中");
  target.hand[index] = wanted;
  state.drawPile[drawIndex] = replacement;
}

function moveToIntelligence(
  state: GameState,
  playerId: string,
  wanted: PhysicalCardId,
): void {
  const drawIndex = state.drawPile.indexOf(wanted);
  if (drawIndex >= 0) {
    state.drawPile.splice(drawIndex, 1);
  } else {
    const owner = Object.values(state.players).find((player) =>
      player.hand.includes(wanted),
    );
    if (!owner) throw new Error("测试牌不在可移动区域中");
    owner.hand.splice(owner.hand.indexOf(wanted), 1);
  }
  state.players[playerId].intelligence.push(wanted);
}

function passAll(state: GameState): void {
  while (state.reactionWindow) {
    passReaction(
      state,
      state.reactionWindow.responderOrder[state.reactionWindow.nextResponderIndex],
    );
  }
}

describe("行动阶段功能牌框架", () => {
  it("使用功能牌时必须保留至少一张用于传递的手牌", () => {
    const state = game(10);
    const reinforcement = cardId("增援");
    putInHand(state, "甲", reinforcement);

    while (state.players["甲"].hand.length > 2) {
      const removed = state.players["甲"].hand.pop();
      if (removed) state.drawPile.push(removed);
    }
    playReinforcement(state, "甲", reinforcement);

    expect(state.players["甲"].hand).toHaveLength(1);
    expect(state.activeFunctionAction?.kind).toBe("reinforcement");

    passAll(state);
    const secondFunction = cardId("机密文件");
    putInHand(state, "甲", secondFunction);
    while (state.players["甲"].hand.length > 1) {
      const removed = state.players["甲"].hand.pop();
      if (removed) state.drawPile.push(removed);
    }
    expect(() => playConfidentialFile(state, "甲", secondFunction)).toThrow(
      "必须至少保留一张手牌用于传递",
    );
  });

  it("从目标下家开始响应，并由目标最后响应后才结算", () => {
    const state = game(11);
    const publicText = cardId("公开文本");
    putInHand(state, "甲", publicText);

    playPublicText(state, "甲", publicText, "乙");
    const targetHandBefore = [...state.players["乙"].hand];

    expect(state.reactionWindow?.responderOrder).toEqual([
      "丙",
      "丁",
      "戊",
      "甲",
      "乙",
    ]);
    for (const responder of ["丙", "丁", "戊", "甲"] as const) {
      passReaction(state, responder);
    }
    expect(state.activeFunctionAction?.kind).toBe("publicText");

    passReaction(state, "乙");
    expect(state.activeFunctionAction).toBeUndefined();
    expect(state.auditLog).toContain(
      "甲交给乙公开文本【黑 · 文本 · 可选方向；特工摸1张；其他阵营选择摸1张或2张】",
    );
    expect(state.auditLog).toContain("甲完成与乙的公开文本交换");
    const takenCardId = targetHandBefore.find(
      (cardId) => !state.players["乙"].hand.includes(cardId),
    );
    expect(takenCardId).toBeDefined();
    expect(projectGameForPlayer(state, "甲").privateNotices).toEqual([
      expect.objectContaining({
        kind: "publicTextGained",
        otherPlayerId: "乙",
        card: expect.objectContaining({ id: takenCardId }),
      }),
    ]);
    expect(projectGameForPlayer(state, "乙").privateNotices).toEqual([
      expect.objectContaining({
        kind: "publicTextLost",
        otherPlayerId: "甲",
        card: expect.objectContaining({ id: takenCardId }),
      }),
    ]);
    expect(projectGameForPlayer(state, "丙").privateNotices).toEqual([]);
  });

  it("识破取消栈顶功能牌，且一次原始行动最多使用一次离间", () => {
    const counterState = game(12);
    const reinforcement = cardId("增援");
    const counter = cardId("识破");
    putInHand(counterState, "甲", reinforcement);
    putInHand(counterState, "乙", counter);
    const handBefore = counterState.players["甲"].hand.length;

    playReinforcement(counterState, "甲", reinforcement);
    const interactionId = counterState.activeFunctionStack.at(-1)?.id;
    if (!interactionId) throw new Error("缺少功能牌互动帧");
    playCounter(counterState, "乙", counter, interactionId);
    passAll(counterState);

    expect(counterState.activeFunctionAction).toBeUndefined();
    expect(counterState.players["甲"].hand).toHaveLength(handBefore - 1);

    const separationState = game(13);
    const text = cardId("公开文本");
    const firstSeparation = cardId("离间");
    const secondSeparation = cardId("离间", [firstSeparation]);
    putInHand(separationState, "甲", text);
    putInHand(separationState, "丙", firstSeparation);
    putInHand(separationState, "戊", secondSeparation);

    playPublicText(separationState, "甲", text, "乙");
    playSeparationOnFunction(
      separationState,
      "丙",
      firstSeparation,
      "丁",
    );
    expect(separationState.activeFunctionAction?.targetPlayerId).toBe("丁");
    expect(separationState.reactionWindow?.responderOrder).toEqual([
      "戊",
      "甲",
      "乙",
      "丙",
      "丁",
    ]);
    expect(() =>
      playSeparationOnFunction(separationState, "戊", secondSeparation, "乙"),
    ).toThrow("同一原始卡牌行动最多使用一次离间");
  });
});

describe("已实现的行动阶段功能牌", () => {
  it("增援摸一加自身黑色情报张数，并在牌库为空时洗回弃牌", () => {
    const state = game(20);
    const reinforcement = cardId("增援");
    const blackOne = cardIdByColor("黑", [reinforcement]);
    const blackTwo = cardIdByColor("黑", [reinforcement, blackOne]);
    putInHand(state, "甲", reinforcement);
    moveToIntelligence(state, "甲", blackOne);
    moveToIntelligence(state, "甲", blackTwo);
    state.publicDiscard.push(...state.drawPile.splice(0));
    const before = state.players["甲"].hand.length;

    playReinforcement(state, "甲", reinforcement);
    passAll(state);

    expect(state.players["甲"].hand).toHaveLength(before - 1 + 3);
    expect(state.auditLog.some((entry) => entry.includes("弃牌堆洗回牌库"))).toBe(
      true,
    );
  });

  it("机密文件按全场红蓝真情报的实体张数摸牌", () => {
    const state = game(21);
    const confidential = cardId("机密文件");
    putInHand(state, "甲", confidential);
    const trueCards = state.drawPile.filter((id) => {
      const color = PHYSICAL_DECK.find((card) => card.id === id)?.color;
      return color !== "黑";
    }).slice(0, 4);
    expect(trueCards).toHaveLength(4);
    trueCards.forEach((id, index) =>
      moveToIntelligence(state, players[index + 1], id),
    );
    const before = state.players["甲"].hand.length;

    playConfidentialFile(state, "甲", confidential);
    passAll(state);

    expect(state.players["甲"].hand).toHaveLength(before - 1 + 2);
  });

  it("场上不足4张真情报时机密文件不可使用且不生成合法行动", () => {
    const state = game(211);
    const confidential = cardId("机密文件");
    putInHand(state, "甲", confidential);

    expect(projectGameForPlayer(state, "甲").legalActions).not.toContainEqual({
      type: "PLAY_CONFIDENTIAL_FILE",
      cardId: confidential,
    });
    expect(() => playConfidentialFile(state, "甲", confidential)).toThrow(
      "场上至少需要4张真情报才能使用机密文件",
    );
    expect(state.players["甲"].hand).toContain(confidential);
  });

  it("公开文本只从目标收到该牌前的随机池中取得一张牌", () => {
    const state = game(22);
    const publicText = cardId("公开文本");
    const originalOne = cardId("锁定");
    const originalTwo = cardId("转移");
    putInHand(state, "甲", publicText);
    putInHand(state, "乙", originalOne, 0);
    putInHand(state, "乙", originalTwo, 1);
    while (state.players["乙"].hand.length > 2) {
      const removed = state.players["乙"].hand.pop();
      if (removed) state.drawPile.push(removed);
    }
    const sourceBefore = state.players["甲"].hand.length;

    playPublicText(state, "甲", publicText, "乙");
    passAll(state);

    expect(state.players["乙"].hand).toContain(publicText);
    expect(state.players["乙"].hand).toHaveLength(2);
    expect(state.players["甲"].hand).toHaveLength(sourceBefore);
    expect(state.players["甲"].hand.some((id) => [originalOne, originalTwo].includes(id))).toBe(
      true,
    );
  });

  it("危险情报仅向使用者展示目标手牌，再公开弃置所选牌", () => {
    const state = game(23);
    const dangerous = cardId("危险情报");
    putInHand(state, "甲", dangerous);
    const chosen = state.players["乙"].hand[0];

    playDangerousIntelligence(state, "甲", dangerous, "乙");
    passAll(state);

    expect(state.activeFunctionAction?.stage).toBe("awaitingDiscard");
    expect(
      projectGameForPlayer(state, "甲").activeFunctionAction?.inspectedHand?.map(
        (card) => card.id,
      ),
    ).toEqual(state.players["乙"].hand);
    expect(
      projectGameForPlayer(state, "乙").activeFunctionAction?.inspectedHand,
    ).toBeUndefined();

    chooseDangerousIntelligenceDiscard(state, "甲", chosen);

    expect(state.players["乙"].hand).not.toContain(chosen);
    expect(state.publicDiscard).toContain(chosen);
    expect(state.activeFunctionAction).toBeUndefined();
  });

  it("危险情报目标只有一张手牌时自动弃置", () => {
    const state = game(24);
    const dangerous = cardId("危险情报");
    putInHand(state, "甲", dangerous);
    state.drawPile.push(...state.players["乙"].hand.splice(1));
    const onlyCard = state.players["乙"].hand[0];

    playDangerousIntelligence(state, "甲", dangerous, "乙");
    passAll(state);

    expect(state.players["乙"].hand).toEqual([]);
    expect(state.publicDiscard).toContain(onlyCard);
    expect(state.activeFunctionAction).toBeUndefined();
  });
});
