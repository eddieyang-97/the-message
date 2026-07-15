import { describe, expect, it } from "vitest";

import {
  PHYSICAL_DECK,
  type PhysicalCard,
  type PhysicalCardId,
  type SecretOrderWord,
} from "./cards";
import {
  chooseProbeDiscard,
  chooseProbeIdentityResponse,
  claimNoSecretOrderMatch,
  enterTransmissionPhase,
  initializeGame,
  passLockOpportunity,
  passReaction,
  playCounter,
  playDecrypt,
  playProbe,
  playSecretOrder,
  projectGameForPlayer,
  startTransmission,
  type GameState,
} from "./engine";

const seats = ["甲", "乙", "丙", "丁", "戊"] as const;

function game(seed: number): GameState {
  const state = initializeGame(seats, seed);
  state.activePlayerId = "甲";
  return state;
}

function card(predicate: (card: PhysicalCard) => boolean): PhysicalCardId {
  const found = PHYSICAL_DECK.find(predicate);
  if (!found) throw new Error("缺少测试牌");
  return found.id;
}

function putInHand(state: GameState, playerId: string, wanted: PhysicalCardId, index = 0): void {
  const target = state.players[playerId];
  if (target.hand[index] === wanted) return;
  const replacement = target.hand[index];
  const owner = Object.values(state.players).find((player) => player.hand.includes(wanted));
  if (owner) {
    const ownerIndex = owner.hand.indexOf(wanted);
    owner.hand[ownerIndex] = replacement;
    target.hand[index] = wanted;
    return;
  }
  const drawIndex = state.drawPile.indexOf(wanted);
  if (drawIndex < 0) throw new Error("测试牌不在可交换区域");
  state.drawPile[drawIndex] = replacement;
  target.hand[index] = wanted;
}

function passAll(state: GameState): void {
  while (state.reactionWindow) {
    passReaction(
      state,
      state.reactionWindow.responderOrder[state.reactionWindow.nextResponderIndex],
    );
  }
}

function passUntil(state: GameState, playerId: string): void {
  while (
    state.reactionWindow &&
    state.reactionWindow.responderOrder[state.reactionWindow.nextResponderIndex] !== playerId
  ) {
    passReaction(
      state,
      state.reactionWindow.responderOrder[state.reactionWindow.nextResponderIndex],
    );
  }
}

describe("试探", () => {
  it("身份型无手牌时必须公开真实阵营对应代码，并永久移出洗牌池", () => {
    const state = game(301);
    const probeId = card((candidate) => candidate.variant?.kind === "probeIdentity");
    putInHand(state, "甲", probeId);
    state.drawPile.push(...state.players["乙"].hand.splice(0));
    const probe: PhysicalCard = PHYSICAL_DECK.find((candidate) => candidate.id === probeId)!;
    if (probe.variant?.kind !== "probeIdentity") throw new Error("测试映射无效");

    playProbe(state, "甲", probeId, "乙");
    passAll(state);

    expect(projectGameForPlayer(state, "乙").legalActions).toEqual([
      { type: "CHOOSE_PROBE_IDENTITY", choice: "announce" },
    ]);
    chooseProbeIdentityResponse(state, "乙", "announce");
    expect(state.removedProbes).toContain(probeId);
    expect(state.auditLog).toContain(
      `乙因试探公开身份代码：${probe.variant.mapping[state.players["乙"].faction]}`,
    );
  });

  it("身份型随机取牌不查看，抽弃型按阵营摸牌或由目标弃牌", () => {
    const identity = game(302);
    const identityId = card((candidate) => candidate.variant?.kind === "probeIdentity");
    putInHand(identity, "甲", identityId);
    const sourceBefore = identity.players["甲"].hand.length;
    const targetBefore = identity.players["乙"].hand.length;
    playProbe(identity, "甲", identityId, "乙");
    passAll(identity);
    chooseProbeIdentityResponse(identity, "乙", "giveRandom");
    expect(identity.players["甲"].hand).toHaveLength(sourceBefore);
    expect(identity.players["乙"].hand).toHaveLength(targetBefore - 1);

    const discard = game(303);
    const discardId = card(
      (candidate) =>
        candidate.variant?.kind === "probeDrawDiscard" &&
        candidate.variant.drawFaction !== discard.players["乙"].faction,
    );
    putInHand(discard, "甲", discardId);
    playProbe(discard, "甲", discardId, "乙");
    passAll(discard);
    const discarded = discard.players["乙"].hand[0];
    chooseProbeDiscard(discard, "乙", discarded);
    expect(discard.publicDiscard).toContain(discarded);

    const draw = game(304);
    const drawId = card(
      (candidate) =>
        candidate.variant?.kind === "probeDrawDiscard" &&
        candidate.variant.drawFaction === draw.players["乙"].faction,
    );
    putInHand(draw, "甲", drawId);
    const before = draw.players["乙"].hand.length;
    playProbe(draw, "甲", drawId, "乙");
    passAll(draw);
    expect(draw.players["乙"].hand).toHaveLength(before + 1);
  });

  it("抽弃型试探遇到唯一手牌时自动弃置", () => {
    const state = game(305);
    const probeId = card(
      (candidate) =>
        candidate.variant?.kind === "probeDrawDiscard" &&
        candidate.variant.drawFaction !== state.players["乙"].faction,
    );
    putInHand(state, "甲", probeId);
    state.drawPile.push(...state.players["乙"].hand.splice(1));
    const onlyCard = state.players["乙"].hand[0];

    playProbe(state, "甲", probeId, "乙");
    passAll(state);

    expect(state.players["乙"].hand).toEqual([]);
    expect(state.publicDiscard).toContain(onlyCard);
    expect(state.activeFunctionAction).toBeUndefined();
  });
});

describe("破译", () => {
  it("仅在普通密电接收决定前私下显示，并可被识破精确取消", () => {
    const state = game(310);
    const intelligence = card((candidate) => candidate.transmission === "密电");
    const decrypt = card((candidate) => candidate.name === "破译" && candidate.id !== intelligence);
    const counter = card((candidate) => candidate.name === "识破");
    putInHand(state, "甲", intelligence);
    putInHand(state, "乙", decrypt);
    putInHand(state, "丙", counter);
    startTransmission(state, "甲", intelligence);
    passLockOpportunity(state, "甲");
    passUntil(state, "乙");
    playDecrypt(state, "乙", decrypt);
    const frame = state.interactionStack.at(-1)!;
    passUntil(state, "丙");
    playCounter(state, "丙", counter, frame.id);
    passAll(state);

    expect(projectGameForPlayer(state, "乙").transmission?.card).toBeUndefined();
    expect(state.transmission?.receiptStage).toBe("decision");
  });

  it("成功结算后只让当前接收者看到情报，且不写入公开记录", () => {
    const state = game(311);
    const intelligence = card((candidate) => candidate.transmission === "直达");
    const decrypt = card((candidate) => candidate.name === "破译" && candidate.id !== intelligence);
    putInHand(state, "甲", intelligence);
    putInHand(state, "乙", decrypt);
    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    passUntil(state, "乙");
    playDecrypt(state, "乙", decrypt);
    passAll(state);

    expect(projectGameForPlayer(state, "乙").transmission?.card?.id).toBe(intelligence);
    expect(projectGameForPlayer(state, "丙").transmission?.card).toBeUndefined();
    expect(state.auditLog.some((entry) => entry.includes(intelligence))).toBe(false);
  });
});

describe("秘密下达", () => {
  it("初始询问不包含准备传情报的玩家", () => {
    const state = game(319);

    enterTransmissionPhase(state, "甲");

    expect(state.reactionWindow?.responderOrder).toEqual(["乙", "丙", "丁", "戊"]);
    expect(projectGameForPlayer(state, "甲").legalActions).not.toContainEqual({
      type: "PASS_REACTION",
    });
  });

  it("在不可逆传递边界使用且只允许匹配颜色，使用牌进入可洗回暗区", () => {
    const state = game(320);
    const orderId = card((candidate) => candidate.variant?.kind === "secretOrder");
    putInHand(state, "乙", orderId);
    const order: PhysicalCard = PHYSICAL_DECK.find((candidate) => candidate.id === orderId)!;
    if (order.variant?.kind !== "secretOrder") throw new Error("测试命令无效");
    const word: SecretOrderWord = "听风";
    const required = order.variant.mapping[word];
    const matching = card(
      (candidate) => candidate.id !== orderId &&
        (candidate.color === required || (candidate.color === "红蓝" && required !== "黑")),
    );
    const nonmatching = card(
      (candidate) => candidate.id !== orderId && candidate.id !== matching &&
        candidate.color !== required && candidate.color !== "红蓝",
    );
    putInHand(state, "甲", matching, 0);
    putInHand(state, "甲", nonmatching, 1);

    enterTransmissionPhase(state, "甲");
    playSecretOrder(state, "乙", orderId, word);
    passAll(state);
    expect(state.hiddenSecretOrders).toContain(orderId);
    expect(state.auditLog.some((entry) => entry.includes("窗口结束"))).toBe(false);
    expect(() => startTransmission(state, "甲", nonmatching)).toThrow("必须传递符合秘密下达颜色");
    const matchingCard: PhysicalCard = PHYSICAL_DECK.find((candidate) => candidate.id === matching)!;
    startTransmission(state, "甲", matching, {
      ...(matchingCard.transmission === "任意" ? { method: "直达" as const } : {}),
      ...((matchingCard.transmission === "直达" || matchingCard.transmission === "任意")
        ? { targetId: "乙" }
        : {}),
      ...(matchingCard.circle
        ? { direction: "clockwise" as const }
        : {}),
    });
    expect(state.pendingSecretOrder).toBeUndefined();
  });

  it("无匹配声明由服务器验证，且仅命令使用者临时看到手牌", () => {
    const state = game(321);
    const orderId = card((candidate) => candidate.variant?.kind === "secretOrder");
    putInHand(state, "乙", orderId);
    const order: PhysicalCard = PHYSICAL_DECK.find((candidate) => candidate.id === orderId)!;
    if (order.variant?.kind !== "secretOrder") throw new Error("测试命令无效");
    const word: SecretOrderWord = "日落";
    const required = order.variant.mapping[word];
    for (let index = 0; index < state.players["甲"].hand.length; index += 1) {
      const current = PHYSICAL_DECK.find((candidate) => candidate.id === state.players["甲"].hand[index])!;
      if (current.color === required || (current.color === "红蓝" && required !== "黑")) {
        const replacement = state.drawPile.find((id) => {
          const candidate = PHYSICAL_DECK.find((entry) => entry.id === id)!;
          return candidate.color !== required && candidate.color !== "红蓝";
        })!;
        putInHand(state, "甲", replacement, index);
      }
    }
    enterTransmissionPhase(state, "甲");
    playSecretOrder(state, "乙", orderId, word);
    passAll(state);
    claimNoSecretOrderMatch(state, "甲");
    expect(projectGameForPlayer(state, "乙").pendingSecretOrder?.inspectedHand?.map((c) => c.id))
      .toEqual(state.players["甲"].hand);
    expect(projectGameForPlayer(state, "丙").pendingSecretOrder?.inspectedHand).toBeUndefined();
  });
});
