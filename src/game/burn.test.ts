import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCardId } from "./cards";
import {
  currentReactionWindow,
  enterTransmissionPhase,
  initializeGame,
  passLockOpportunity,
  passReaction,
  playBurn,
  playCounter,
  playDangerousIntelligence,
  playPublicText,
  projectGameForPlayer,
  resolveHostImposedDeath,
  startTransmission,
  type BurnContext,
  type BurnFrame,
  type GameState,
  type ReactionWindow,
} from "./engine";

const players = ["甲", "乙", "丙", "丁", "戊"] as const;
const unburnableIds = [
  "p2-06",
  "p3-01",
  "p3-05",
  "p3-09",
  "p4-15",
  "p5-13",
  "p6-05",
] as const satisfies readonly PhysicalCardId[];

function unresolvedBurns(
  state: GameState,
): Array<BurnContext & { frames: BurnFrame[] }> {
  return state.resolutionStack.flatMap((context) =>
    context.kind === "burn"
      ? [{ ...context.burn, frames: context.frames }]
      : [],
  );
}

function game(seed = 701): GameState {
  const state = initializeGame(players, seed);
  state.activePlayerId = "甲";
  return state;
}

function findCard(
  predicate: (card: (typeof PHYSICAL_DECK)[number]) => boolean,
  excluded: readonly PhysicalCardId[] = [],
): PhysicalCardId {
  const card = PHYSICAL_DECK.find(
    (candidate) => predicate(candidate) && !excluded.includes(candidate.id),
  );
  if (!card) throw new Error("找不到测试牌");
  return card.id;
}

function inHand(state: GameState, playerId: string, wanted: PhysicalCardId): void {
  const target = state.players[playerId];
  const owner = Object.values(state.players).find((player) =>
    player.hand.includes(wanted),
  );
  if (owner) {
    if (owner.id === playerId) return;
    const replacement = target.hand[0];
    target.hand[0] = wanted;
    owner.hand[owner.hand.indexOf(wanted)] = replacement;
    return;
  }
  const drawIndex = state.drawPile.indexOf(wanted);
  if (drawIndex < 0) throw new Error("测试牌不在可交换区域");
  const replacement = target.hand[0];
  target.hand[0] = wanted;
  state.drawPile[drawIndex] = replacement;
}

function setExactHand(
  state: GameState,
  playerId: string,
  wanted: readonly PhysicalCardId[],
): void {
  for (const cardId of wanted) {
    const owner = Object.values(state.players).find((player) =>
      player.hand.includes(cardId),
    );
    if (owner) owner.hand.splice(owner.hand.indexOf(cardId), 1);
    else {
      const drawIndex = state.drawPile.indexOf(cardId);
      if (drawIndex < 0) throw new Error("测试牌不在手牌或牌库中");
      state.drawPile.splice(drawIndex, 1);
    }
  }
  state.drawPile.push(...state.players[playerId].hand.splice(0));
  state.players[playerId].hand.push(...wanted);
}

function acceptedBy(state: GameState, playerId: string, wanted: PhysicalCardId): void {
  const drawIndex = state.drawPile.indexOf(wanted);
  if (drawIndex >= 0) state.drawPile.splice(drawIndex, 1);
  else {
    const owner = Object.values(state.players).find((player) =>
      player.hand.includes(wanted),
    );
    if (!owner) throw new Error("测试牌不在手牌或牌库中");
    owner.hand.splice(owner.hand.indexOf(wanted), 1);
  }
  state.players[playerId].intelligence.push(wanted);
}

function passCurrentWindow(state: GameState): void {
  const kind = currentReactionWindow(state)?.kind;
  while (currentReactionWindow(state)?.kind === kind) {
    const window = currentReactionWindow(state)!;
    passReaction(state, window.responderOrder[window.nextResponderIndex]);
  }
}

function ordinaryBlack(excluded: readonly PhysicalCardId[] = []): PhysicalCardId {
  return findCard(
    (card) => card.color === "黑" && !card.unburnable && card.name !== "烧毁",
    excluded,
  );
}

describe("烧毁", () => {
  it("传递开始前仍禁止行动玩家用掉最后一张烧毁", () => {
    const state = game(713);
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([burn]);
    setExactHand(state, "甲", [burn]);
    acceptedBy(state, "乙", intelligence);

    expect(projectGameForPlayer(state, "甲").legalActions).not.toContainEqual(
      expect.objectContaining({ type: "PLAY_BURN", cardId: burn }),
    );
    expect(() => playBurn(state, "甲", burn, "乙", intelligence)).toThrow(
      "必须至少保留一张手牌用于传递",
    );
  });

  it("传递开始后允许行动玩家使用最后一张烧毁", () => {
    const state = game(714);
    const transmitted = findCard(
      (card) => card.transmission === "直达" && card.name !== "烧毁",
    );
    const burn = findCard((card) => card.name === "烧毁", [transmitted]);
    const intelligence = ordinaryBlack([transmitted, burn]);
    setExactHand(state, "甲", [transmitted, burn]);
    acceptedBy(state, "丁", intelligence);
    enterTransmissionPhase(state, "甲");
    passCurrentWindow(state);
    startTransmission(state, "甲", transmitted, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    while (
      currentReactionWindow(state)?.responderOrder[currentReactionWindow(state)!.nextResponderIndex] !== "甲"
    ) {
      const window = currentReactionWindow(state);
      if (!window) throw new Error("情报响应窗口提前结束");
      passReaction(state, window.responderOrder[window.nextResponderIndex]);
    }

    expect(state.players["甲"].hand).toEqual([burn]);
    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "PLAY_BURN",
      cardId: burn,
      targetPlayerId: "丁",
      targetIntelligenceCardId: intelligence,
    });
    playBurn(state, "甲", burn, "丁", intelligence);

    expect(state.players["甲"].hand).toEqual([]);
    expect(currentReactionWindow(state)?.kind).toBe("burn");
  });

  it("传递开始后允许行动玩家在烧毁链中使用最后一张识破", () => {
    const state = game(715);
    const transmitted = findCard(
      (card) => card.transmission === "直达",
    );
    const counter = findCard((card) => card.name === "识破", [transmitted]);
    const burn = findCard((card) => card.name === "烧毁", [transmitted, counter]);
    const intelligence = ordinaryBlack([transmitted, counter, burn]);
    setExactHand(state, "甲", [transmitted, counter]);
    setExactHand(state, "丙", [burn]);
    acceptedBy(state, "丁", intelligence);
    enterTransmissionPhase(state, "甲");
    passCurrentWindow(state);
    startTransmission(state, "甲", transmitted, { targetId: "乙" });
    passLockOpportunity(state, "甲");

    expect(
      currentReactionWindow(state)?.responderOrder[currentReactionWindow(state)!.nextResponderIndex],
    ).toBe("丙");
    playBurn(state, "丙", burn, "丁", intelligence);
    expect(
      currentReactionWindow(state)?.responderOrder[currentReactionWindow(state)!.nextResponderIndex],
    ).toBe("戊");
    passReaction(state, "戊");
    const burnFrame = unresolvedBurns(state).at(-1)!.frames.at(-1)!;

    expect(state.players["甲"].hand).toEqual([counter]);
    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "PLAY_COUNTER",
      cardId: counter,
      targetInteractionId: burnFrame.id,
    });
    playCounter(state, "甲", counter, burnFrame.id);

    expect(state.players["甲"].hand).toEqual([]);
    expect(unresolvedBurns(state).at(-1)?.countered).toBe(true);
  });

  it("在行动阶段烧毁存活玩家可烧毁的已接收黑色情报", () => {
    const state = game();
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([burn]);
    inHand(state, "甲", burn);
    acceptedBy(state, "乙", intelligence);

    expect(projectGameForPlayer(state, "甲").legalActions).toContainEqual({
      type: "PLAY_BURN",
      cardId: burn,
      targetPlayerId: "乙",
      targetIntelligenceCardId: intelligence,
    });
    playBurn(state, "甲", burn, "乙", intelligence);
    passCurrentWindow(state);

    expect(state.players["乙"].intelligence).not.toContain(intelligence);
    expect(state.publicDiscard).toEqual(expect.arrayContaining([burn, intelligence]));
    const burnedCard = PHYSICAL_DECK.find((card) => card.id === intelligence)!;
    expect(state.auditLog).toContain(
      `乙的黑色情报「${burnedCard.name}（${burnedCard.color} · ${burnedCard.transmission}）」被烧毁并公开弃置`,
    );
  });

  it.each(unburnableIds)(
    "拒绝带不可烧毁标记的实体牌 %s",
    (intelligence) => {
      const state = game();
      const burn = findCard((card) => card.name === "烧毁");
      inHand(state, "甲", burn);
      acceptedBy(state, "乙", intelligence);
      expect(() => playBurn(state, "甲", burn, "乙", intelligence)).toThrow(
        "不可烧毁",
      );
    },
  );

  it("合法行动只生成存活玩家面前可烧毁的已接收黑色情报", () => {
    const state = game(712);
    const burn = findCard((card) => card.name === "烧毁");
    const burnable = ordinaryBlack([burn]);
    const deadOwnerBurnable = ordinaryBlack([burn, burnable]);
    const unburnable = unburnableIds[0];
    const nonBlack = findCard(
      (card) => card.color !== "黑" && ![burn, burnable, deadOwnerBurnable].includes(card.id),
    );
    inHand(state, "甲", burn);
    acceptedBy(state, "乙", burnable);
    acceptedBy(state, "丙", unburnable);
    acceptedBy(state, "丁", nonBlack);
    acceptedBy(state, "戊", deadOwnerBurnable);
    state.players["戊"].alive = false;
    state.players["戊"].factionRevealed = true;

    const burnActions = projectGameForPlayer(state, "甲").legalActions.filter(
      (action) => action.type === "PLAY_BURN",
    );

    expect(burnActions).toEqual([{
      type: "PLAY_BURN",
      cardId: burn,
      targetPlayerId: "乙",
      targetIntelligenceCardId: burnable,
    }]);
    expect(() => playBurn(state, "甲", burn, "丙", unburnable)).toThrow(
      "不可烧毁",
    );
    expect(() => playBurn(state, "甲", burn, "丁", nonBlack)).toThrow(
      "只能以黑色情报为目标",
    );
    expect(() => playBurn(state, "甲", burn, "戊", deadOwnerBurnable)).toThrow(
      "只能以存活玩家的情报为目标",
    );
  });

  it("识破恢复烧毁前状态，反识破则重新使烧毁生效", () => {
    const state = game();
    const burn = findCard((card) => card.name === "烧毁");
    const counter1 = findCard((card) => card.name === "识破");
    const counter2 = findCard((card) => card.name === "识破", [counter1]);
    const intelligence = ordinaryBlack([burn, counter1, counter2]);
    inHand(state, "甲", burn);
    inHand(state, "丙", counter1);
    inHand(state, "乙", counter2);
    acceptedBy(state, "乙", intelligence);

    playBurn(state, "甲", burn, "乙", intelligence);
    const burnFrame = unresolvedBurns(state).at(-1)!.frames.at(-1)!;
    playCounter(state, "丙", counter1, burnFrame.id);
    const firstCounter = unresolvedBurns(state).at(-1)!.frames.at(-1)!;
    playCounter(state, "乙", counter2, firstCounter.id);
    expect(state.auditLog.at(-1)).toBe("乙使用识破，反制丙的识破");
    passCurrentWindow(state);

    expect(state.players["乙"].intelligence).not.toContain(intelligence);
  });

  it("单次识破使目标情报保持原位", () => {
    const state = game(702);
    const burn = findCard((card) => card.name === "烧毁");
    const counter = findCard((card) => card.name === "识破");
    const intelligence = ordinaryBlack([burn, counter]);
    inHand(state, "甲", burn);
    inHand(state, "丙", counter);
    acceptedBy(state, "乙", intelligence);
    playBurn(state, "甲", burn, "乙", intelligence);
    playCounter(state, "丙", counter, unresolvedBurns(state).at(-1)!.frames[0].id);
    passCurrentWindow(state);
    expect(state.players["乙"].intelligence).toContain(intelligence);
  });

  it("嵌套烧毁结算后精确恢复被暂停的功能牌响应优先级", () => {
    const state = game(703);
    const publicText = findCard((card) => card.name === "公开文本");
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([publicText, burn]);
    inHand(state, "甲", publicText);
    inHand(state, "丙", burn);
    acceptedBy(state, "丁", intelligence);
    playPublicText(state, "甲", publicText, "乙");
    const suspended: ReactionWindow = structuredClone(currentReactionWindow(state)!);

    playBurn(state, "丙", burn, "丁", intelligence);
    passCurrentWindow(state);

    expect(currentReactionWindow(state)).toEqual(suspended);
    expect(state.activeFunctionAction?.kind).toBe("publicText");
  });

  it.each([
    ["公开文本", playPublicText],
    ["危险情报", playDangerousIntelligence],
  ] as const)("%s的当前目标不能在响应窗口使用有被处理风险的烧毁", (_name, play) => {
    const state = game(712);
    const functionCard = findCard((card) => card.name === _name);
    const burn = findCard((card) => card.name === "烧毁", [functionCard]);
    const intelligence = ordinaryBlack([functionCard, burn]);
    inHand(state, "甲", functionCard);
    inHand(state, "乙", burn);
    acceptedBy(state, "丁", intelligence);
    play(state, "甲", functionCard, "乙");
    while (
      currentReactionWindow(state)?.responderOrder[currentReactionWindow(state)!.nextResponderIndex] !== "乙"
    ) {
      const window = currentReactionWindow(state);
      if (!window) throw new Error("功能牌响应窗口提前结束");
      passReaction(state, window.responderOrder[window.nextResponderIndex]);
    }

    expect(projectGameForPlayer(state, "乙").legalActions).not.toContainEqual(
      expect.objectContaining({ type: "PLAY_BURN", cardId: burn }),
    );
    expect(() => playBurn(state, "乙", burn, "丁", intelligence)).toThrow(
      "当前没有可使用烧毁",
    );
    expect(state.players["乙"].hand).toContain(burn);
  });

  it("在秘密下达窗口中烧毁后恢复原响应位置", () => {
    const state = game(707);
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([burn]);
    inHand(state, "乙", burn);
    acceptedBy(state, "丙", intelligence);
    enterTransmissionPhase(state, "甲");
    const suspended = structuredClone(currentReactionWindow(state)!);

    playBurn(state, "乙", burn, "丙", intelligence);
    passCurrentWindow(state);

    expect(currentReactionWindow(state)).toEqual(suspended);
    expect(state.pendingSecretOrder?.stage).toBe("offering");
  });

  it("在情报响应窗口中烧毁后恢复原响应位置", () => {
    const state = game(708);
    const transmitted = findCard(
      (card) => card.transmission === "直达" && card.name !== "烧毁",
    );
    const burn = findCard((card) => card.name === "烧毁", [transmitted]);
    const intelligence = ordinaryBlack([transmitted, burn]);
    inHand(state, "甲", transmitted);
    inHand(state, "丙", burn);
    acceptedBy(state, "丁", intelligence);
    enterTransmissionPhase(state, "甲");
    passCurrentWindow(state);
    startTransmission(state, "甲", transmitted, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    const suspended = structuredClone(currentReactionWindow(state)!);

    playBurn(state, "丙", burn, "丁", intelligence);
    passCurrentWindow(state);

    expect(currentReactionWindow(state)).toEqual(suspended);
    expect(state.transmission?.receiptStage).toBe("reactions");
  });

  it("允许嵌套烧毁同一情报，外层随后安全空结算", () => {
    const state = game(704);
    const burn1 = findCard((card) => card.name === "烧毁");
    const burn2 = findCard((card) => card.name === "烧毁", [burn1]);
    const intelligence = ordinaryBlack([burn1, burn2]);
    inHand(state, "甲", burn1);
    inHand(state, "丙", burn2);
    acceptedBy(state, "乙", intelligence);

    playBurn(state, "甲", burn1, "乙", intelligence);
    const outer = structuredClone(currentReactionWindow(state)!);
    playBurn(state, "丙", burn2, "乙", intelligence);
    while (unresolvedBurns(state).length === 2) {
      const window = currentReactionWindow(state)!;
      passReaction(state, window.responderOrder[window.nextResponderIndex]);
    }
    expect(currentReactionWindow(state)).toEqual(outer);
    passCurrentWindow(state);

    expect(state.players["乙"].intelligence).not.toContain(intelligence);
    expect(state.publicDiscard.filter((id) => id === intelligence)).toHaveLength(1);
    expect(unresolvedBurns(state)).toHaveLength(0);
  });

  it("强制死亡会修剪烧毁及其暂停窗口中的响应顺序", () => {
    const state = game(705);
    const publicText = findCard((card) => card.name === "公开文本");
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([publicText, burn]);
    inHand(state, "甲", publicText);
    inHand(state, "丙", burn);
    acceptedBy(state, "丁", intelligence);
    playPublicText(state, "甲", publicText, "乙");
    playBurn(state, "丙", burn, "丁", intelligence);

    resolveHostImposedDeath(state, "戊");
    expect(currentReactionWindow(state)?.responderOrder).not.toContain("戊");
    passCurrentWindow(state);
    expect(currentReactionWindow(state)?.kind).toBe("function");
    expect(currentReactionWindow(state)?.responderOrder).not.toContain("戊");
    expect(state.players["丁"].intelligence).not.toContain(intelligence);
  });

  it("烧毁目标玩家在结算前死亡时保留其情报", () => {
    const state = game(709);
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([burn]);
    inHand(state, "甲", burn);
    acceptedBy(state, "乙", intelligence);
    playBurn(state, "甲", burn, "乙", intelligence);

    resolveHostImposedDeath(state, "乙");
    passCurrentWindow(state);

    expect(state.players["乙"].intelligence).toContain(intelligence);
    expect(unresolvedBurns(state)).toHaveLength(0);
  });

  it("死亡使暂停窗口已全部通过时，恢复后自动递归结算而不重开优先级", () => {
    const state = game(710);
    const burn1 = findCard((card) => card.name === "烧毁");
    const burn2 = findCard((card) => card.name === "烧毁", [burn1]);
    const outerIntelligence = ordinaryBlack([burn1, burn2]);
    const innerIntelligence = ordinaryBlack([burn1, burn2, outerIntelligence]);
    inHand(state, "甲", burn1);
    inHand(state, "乙", burn2);
    acceptedBy(state, "乙", outerIntelligence);
    acceptedBy(state, "丙", innerIntelligence);
    playBurn(state, "甲", burn1, "乙", outerIntelligence);

    for (const responder of ["丙", "丁", "戊", "甲"] as const) {
      expect(
        currentReactionWindow(state)?.responderOrder[currentReactionWindow(state)!.nextResponderIndex],
      ).toBe(responder);
      passReaction(state, responder);
    }
    playBurn(state, "乙", burn2, "丙", innerIntelligence);
    resolveHostImposedDeath(state, "乙");
    passCurrentWindow(state);

    expect(currentReactionWindow(state)).toBeUndefined();
    expect(unresolvedBurns(state)).toHaveLength(0);
    expect(state.players["乙"].intelligence).toContain(outerIntelligence);
    expect(state.players["丙"].intelligence).not.toContain(innerIntelligence);
  });

  it("死亡清理底层功能牌流程时取消顶层待结算烧毁且不返还牌", () => {
    const state = game(711);
    const publicText = findCard((card) => card.name === "公开文本");
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([publicText, burn]);
    inHand(state, "甲", publicText);
    inHand(state, "丙", burn);
    acceptedBy(state, "丁", intelligence);
    playPublicText(state, "甲", publicText, "乙");
    playBurn(state, "丙", burn, "丁", intelligence);

    resolveHostImposedDeath(state, "乙");

    expect(unresolvedBurns(state)).toHaveLength(0);
    expect(currentReactionWindow(state)).toBeUndefined();
    expect(state.activeFunctionAction).toBeUndefined();
    expect(state.players["丁"].intelligence).toContain(intelligence);
    expect(state.publicDiscard).toContain(burn);
  });

  it("强制选择等原子结算阶段不能插入烧毁", () => {
    const state = game(706);
    const burn = findCard((card) => card.name === "烧毁");
    const intelligence = ordinaryBlack([burn]);
    inHand(state, "甲", burn);
    acceptedBy(state, "乙", intelligence);
    state.phase = "resolvingReceipt";
    state.pendingPublicTextReceipt = {
      recipientId: "乙",
      cardId: intelligence,
      stage: "choice",
      choices: ["drawOne"],
    };

    expect(() => playBurn(state, "甲", burn, "乙", intelligence)).toThrow(
      "当前没有可使用烧毁",
    );
  });
});
