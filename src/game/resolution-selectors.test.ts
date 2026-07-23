import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCardId } from "./cards";
import {
  currentPromptFingerprint,
  currentReactionWindow,
  currentResolutionContext,
  currentResponderId,
  currentResponseFrames,
  enterTransmissionPhase,
  initializeGame,
  passLockOpportunity,
  passReaction,
  playBurn,
  playPublicText,
  projectGameForPlayer,
  projectGameForSpectator,
  startTransmission,
  topResponseFrame,
  type GameState,
  type StartTransmissionOptions,
} from "./engine";

const players = ["甲", "乙", "丙", "丁", "戊"] as const;

function game(seed: number): GameState {
  const state = initializeGame(players, seed);
  state.activePlayerId = "甲";
  return state;
}

function cardId(
  predicate: (card: (typeof PHYSICAL_DECK)[number]) => boolean,
  excluded: readonly PhysicalCardId[] = [],
): PhysicalCardId {
  const card = PHYSICAL_DECK.find(
    (candidate) => predicate(candidate) && !excluded.includes(candidate.id),
  );
  if (!card) throw new Error("找不到测试牌");
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
    owner.hand[owner.hand.indexOf(wanted)] = replacement;
  } else {
    const drawIndex = state.drawPile.indexOf(wanted);
    if (drawIndex < 0) throw new Error("测试牌不在手牌或牌库中");
    state.drawPile[drawIndex] = replacement;
  }
  target.hand[index] = wanted;
}

function moveToIntelligence(
  state: GameState,
  playerId: string,
  wanted: PhysicalCardId,
): void {
  const owner = Object.values(state.players).find((player) =>
    player.hand.includes(wanted),
  );
  if (owner) {
    owner.hand.splice(owner.hand.indexOf(wanted), 1);
  } else {
    const drawIndex = state.drawPile.indexOf(wanted);
    if (drawIndex < 0) throw new Error("测试牌不在手牌或牌库中");
    state.drawPile.splice(drawIndex, 1);
  }
  state.players[playerId].intelligence.push(wanted);
}

function transmissionOptions(
  state: GameState,
  cardId: PhysicalCardId,
): StartTransmissionOptions {
  const card = PHYSICAL_DECK.find((candidate) => candidate.id === cardId)!;
  const method = card.transmission === "任意" ? "直达" : card.transmission;
  return {
    ...(card.transmission === "任意" ? { method } : {}),
    ...(method === "直达" ? { targetId: "乙" } : {}),
    ...(card.circle && method !== "直达"
      ? { direction: "clockwise" as const }
      : {}),
  };
}

describe("统一解析状态读取器", () => {
  it("无响应时返回空读取模型", () => {
    const state = game(901);

    expect(currentResolutionContext(state)).toBeUndefined();
    expect(currentReactionWindow(state)).toBeUndefined();
    expect(currentResponseFrames(state)).toEqual([]);
    expect(topResponseFrame(state)).toBeUndefined();
    expect(currentResponderId(state)).toBeUndefined();
    expect(currentPromptFingerprint(state)).toBeUndefined();
  });

  it("将功能牌窗口和顶层帧映射到同一上下文", () => {
    const state = game(902);
    const publicText = cardId((card) => card.name === "公开文本");
    putInHand(state, "甲", publicText);

    playPublicText(state, "甲", publicText, "乙");

    const context = currentResolutionContext(state);
    expect(context).toMatchObject({ kind: "function" });
    expect(context?.frames).toHaveLength(1);
    expect(currentReactionWindow(state)).toBe(
      state.resolutionStack.at(-1)?.window,
    );
    expect(topResponseFrame(state)).toBe(context?.frames.at(-1));
    expect(currentResponderId(state)).toBe(
      currentReactionWindow(state)?.responderOrder[currentReactionWindow(state)!.nextResponderIndex],
    );
    expect(currentPromptFingerprint(state)).toContain(
      context!.frames.at(-1)!.id,
    );
    expect(projectGameForSpectator(state).responseStack).toEqual(
      projectGameForPlayer(state, "乙").responseStack,
    );
  });

  it("将烧毁嵌套窗口映射到最上层烧毁上下文", () => {
    const state = game(903);
    const burn = cardId((card) => card.name === "烧毁");
    const intelligence = cardId(
      (card) => card.color === "黑" && !card.unburnable && card.name !== "烧毁",
      [burn],
    );
    putInHand(state, "甲", burn);
    moveToIntelligence(state, "乙", intelligence);

    playBurn(state, "甲", burn, "乙", intelligence);

    const context = currentResolutionContext(state);
    expect(context).toMatchObject({ kind: "burn" });
    expect(context?.kind === "burn" ? context.burn.sourceCardId : undefined)
      .toBe(burn);
    expect(topResponseFrame(state)).toBe(context?.frames.at(-1));
  });

  it("将秘密下达询问窗口映射为无帧的秘密下达上下文", () => {
    const state = game(905);

    enterTransmissionPhase(state, "甲");

    const context = currentResolutionContext(state);
    expect(context).toMatchObject({ kind: "secretOrder" });
    expect(context?.frames).toEqual([]);
    expect(currentResponseFrames(state)).toEqual([]);
    expect(currentResponderId(state)).toBe("乙");
  });

  it("保持锁定提示及随后情报响应的指纹兼容", () => {
    const state = game(904);
    const transmittedCard = state.players["甲"].hand[0]!;

    startTransmission(
      state,
      "甲",
      transmittedCard,
      transmissionOptions(state, transmittedCard),
    );

    expect(currentResolutionContext(state)).toBeUndefined();
    expect(currentPromptFingerprint(state)).toBe(
      `lock:${state.transmission?.receiptCycle}:甲:${state.transmission?.intendedRecipientId}`,
    );

    passLockOpportunity(state, "甲");

    const context = currentResolutionContext(state);
    expect(context).toMatchObject({ kind: "receipt" });
    expect(context?.frames).toEqual([]);
    expect(currentResponseFrames(state)).toEqual([]);
    expect(currentPromptFingerprint(state)).toMatch(/^reaction:intelligence:/);

    const firstResponder = currentResponderId(state)!;
    const firstFingerprint = currentPromptFingerprint(state);
    passReaction(state, firstResponder);
    expect(currentResponderId(state)).not.toBe(firstResponder);
    expect(currentPromptFingerprint(state)).not.toBe(firstFingerprint);
  });
});
