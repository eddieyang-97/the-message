import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK, type PhysicalCard, type PhysicalCardId } from "./cards";
import {
  acceptIntelligence,
  enterTransmissionPhase,
  initializeGame,
  passReaction,
  passLockOpportunity,
  playIntercept,
  playLock,
  playProbe,
  playReinforcement,
  playSecretOrder,
  resolveHostImposedDeath,
  startTransmission,
  type GameState,
} from "./engine";

const seats = ["甲", "乙", "丙", "丁", "戊"] as const;

function game(seed: number): GameState {
  const state = initializeGame(seats, seed);
  state.activePlayerId = "甲";
  return state;
}

function findCard(predicate: (card: PhysicalCard) => boolean): PhysicalCardId {
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

describe("房主判定断线玩家死亡", () => {
  it("最后一个敌对阵营玩家死亡时由仍有多名存活者的阵营获胜", () => {
    const state = game(400);
    const survivingFaction = "军情";
    const survivors = seats.filter(
      (id) => state.players[id].faction === survivingFaction,
    );
    const finalOpponent = seats.find(
      (id) => state.players[id].faction !== survivingFaction,
    );
    if (survivors.length < 2 || !finalOpponent) throw new Error("测试阵营分配无效");
    state.activePlayerId = survivors[0];
    for (const id of seats) {
      if (!survivors.includes(id) && id !== finalOpponent) {
        state.players[id].alive = false;
        state.players[id].factionRevealed = true;
      }
    }

    resolveHostImposedDeath(state, finalOpponent);

    expect(state.winner).toEqual({ kind: "faction", faction: survivingFaction });
    expect(state.phase).toBe("gameOver");
  });

  it("只剩多名特工时继续游戏，直到只剩一名特工", () => {
    const state = initializeGame(["甲", "乙", "丙", "丁", "戊", "己"], 4001);
    const agents = state.seatOrder.filter(
      (id) => state.players[id].faction === "特工",
    );
    const finalNonAgent = state.seatOrder.find(
      (id) => state.players[id].faction !== "特工",
    );
    if (agents.length !== 2 || !finalNonAgent) throw new Error("测试阵营分配无效");
    state.activePlayerId = agents[0];
    for (const id of state.seatOrder) {
      if (!agents.includes(id) && id !== finalNonAgent) {
        state.players[id].alive = false;
        state.players[id].factionRevealed = true;
      }
    }

    resolveHostImposedDeath(state, finalNonAgent);

    expect(state.winner).toBeUndefined();
    expect(state.phase).toBe("initialized");
    resolveHostImposedDeath(state, agents[1]);
    expect(state.winner).toEqual({ kind: "agent", playerId: agents[0] });
    expect(state.phase).toBe("gameOver");
  });

  it("立即公开阵营，并把当前响应者当作放弃后从优先级移除", () => {
    const state = game(401);
    const reinforcement = findCard((card) => card.name === "增援");
    putInHand(state, "甲", reinforcement);
    playReinforcement(state, "甲", reinforcement);
    expect(state.reactionWindow?.responderOrder[0]).toBe("乙");

    resolveHostImposedDeath(state, "乙");

    expect(state.players["乙"]).toMatchObject({ alive: false, factionRevealed: true });
    expect(state.reactionWindow?.responderOrder).not.toContain("乙");
    expect(state.reactionWindow?.responderOrder[state.reactionWindow.nextResponderIndex]).toBe("丙");
    expect(state.auditLog.some((entry) => entry.includes("乙被房主判定死亡"))).toBe(true);
    passAll(state);
  });

  it("当前行动玩家死亡时中止回合，公开弃置待传情报并顺时针推进", () => {
    const state = game(402);
    const intelligence = findCard((card) => card.transmission === "直达");
    putInHand(state, "甲", intelligence);
    const nextHandBefore = state.players["乙"].hand.length;
    startTransmission(state, "甲", intelligence, { targetId: "乙" });

    resolveHostImposedDeath(state, "甲");

    expect(state.publicDiscard).toContain(intelligence);
    expect(state.transmission).toBeUndefined();
    expect(state.activePlayerId).toBe("乙");
    expect(state.players["乙"].hand).toHaveLength(nextHandBefore + 2);
    expect(state.phase).toBe("initialized");
  });

  it("普通接收者死亡视为拒绝，而锁定接收者死亡会弃置情报并结束回合", () => {
    const ordinary = game(403);
    const direct = findCard((card) => card.transmission === "直达");
    putInHand(ordinary, "甲", direct);
    startTransmission(ordinary, "甲", direct, { targetId: "乙" });
    resolveHostImposedDeath(ordinary, "乙");
    expect(ordinary.transmission?.intendedRecipientId).toBe("甲");
    expect(ordinary.transmission?.returnedToSender).toBe(true);
    expect(ordinary.publicDiscard).not.toContain(direct);

    const locked = game(404);
    const lockedDirect = findCard((card) => card.transmission === "直达");
    const lock = findCard((card) => card.name === "锁定" && card.id !== lockedDirect);
    putInHand(locked, "甲", lockedDirect, 0);
    putInHand(locked, "甲", lock, 1);
    startTransmission(locked, "甲", lockedDirect, { targetId: "乙" });
    playLock(locked, "甲", lock);
    resolveHostImposedDeath(locked, "乙");
    expect(locked.publicDiscard).toContain(lockedDirect);
    expect(locked.transmission).toBeUndefined();
    expect(locked.activePlayerId).toBe("丙");
  });

  it("截获承诺接收者死亡时公开弃置待传情报", () => {
    const state = game(409);
    const intelligence = findCard((card) => card.transmission === "直达");
    const intercept = findCard((card) => card.name === "截获");
    putInHand(state, "甲", intelligence);
    putInHand(state, "丙", intercept);
    startTransmission(state, "甲", intelligence, { targetId: "乙" });
    passLockOpportunity(state, "甲");
    expect(state.reactionWindow?.responderOrder[0]).toBe("丙");
    playIntercept(state, "丙", intercept);

    resolveHostImposedDeath(state, "丙");

    expect(state.publicDiscard).toContain(intelligence);
    expect(state.transmission).toBeUndefined();
    expect(state.activePlayerId).toBe("乙");
  });

  it("功能牌必需目标死亡时取消未完成效果，已打出的牌仍留在原区域", () => {
    const state = game(405);
    const probe = findCard((card) => card.variant?.kind === "probeIdentity");
    putInHand(state, "甲", probe);
    playProbe(state, "甲", probe, "乙");

    resolveHostImposedDeath(state, "乙");

    expect(state.activeFunctionAction).toBeUndefined();
    expect(state.reactionWindow).toBeUndefined();
    expect(state.removedProbes).toContain(probe);
    expect(state.phase).toBe("initialized");
  });

  it("秘密下达使用者死亡时取消限制，但暗置使用牌仍可洗回", () => {
    const state = game(406);
    const order = findCard((card) => card.variant?.kind === "secretOrder");
    putInHand(state, "乙", order);
    enterTransmissionPhase(state, "甲");
    playSecretOrder(state, "乙", order, "听风");

    resolveHostImposedDeath(state, "乙");

    expect(state.hiddenSecretOrders).toContain(order);
    expect(state.pendingSecretOrder).toMatchObject({
      stage: "selection",
      countered: true,
      targetPlayerId: "甲",
    });
    expect(state.reactionWindow).toBeUndefined();
  });

  it("公开文本接收后的必选效果因接收者死亡而取消并结束回合", () => {
    const state = game(410);
    const faction = state.players["乙"].faction;
    const publicText = findCard(
      (card) =>
        card.name === "公开文本" &&
        ((card.color === "红" && faction !== "潜伏") ||
          (card.color === "蓝" && faction !== "军情")),
    );
    const physical = PHYSICAL_DECK.find((card) => card.id === publicText)!;
    putInHand(state, "甲", publicText);
    startTransmission(state, "甲", publicText, {
      ...(physical.circle ? { direction: "clockwise" as const } : {}),
    });
    passLockOpportunity(state, "甲");
    passAll(state);
    acceptIntelligence(state, "乙");
    expect(state.pendingPublicTextReceipt?.recipientId).toBe("乙");

    resolveHostImposedDeath(state, "乙");

    expect(state.pendingPublicTextReceipt).toBeUndefined();
    expect(state.players["乙"].intelligence).toContain(publicText);
    expect(state.activePlayerId).toBe("丙");
    expect(state.phase).toBe("initialized");
  });

  it("仅剩一人时立即按其阵营获胜，特工按个人获胜", () => {
    const factionState = game(407);
    factionState.activePlayerId = "甲";
    for (const id of ["丙", "丁", "戊"] as const) {
      factionState.players[id].alive = false;
      factionState.players[id].factionRevealed = true;
    }
    resolveHostImposedDeath(factionState, "乙");
    expect(factionState.winner).toEqual(
      factionState.players["甲"].faction === "特工"
        ? { kind: "agent", playerId: "甲" }
        : { kind: "faction", faction: factionState.players["甲"].faction },
    );
    expect(factionState.phase).toBe("gameOver");

    const agentState = game(408);
    const agentId = seats.find((id) => agentState.players[id].faction === "特工")!;
    const victimId = seats.find((id) => id !== agentId)!;
    agentState.activePlayerId = agentId;
    for (const id of seats) {
      if (id !== agentId && id !== victimId) {
        agentState.players[id].alive = false;
        agentState.players[id].factionRevealed = true;
      }
    }
    resolveHostImposedDeath(agentState, victimId);
    expect(agentState.winner).toEqual({ kind: "agent", playerId: agentId });
  });
});
