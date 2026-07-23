import { describe, expect, it } from "vitest";

import {
  PHYSICAL_DECK,
  type PhysicalCardId,
} from "../game/cards";
import type { GameState } from "../game/engine";
import { GameSessionError, GameSessionService } from "./game-session";

const players = ["甲", "乙", "丙", "丁", "戊"];

describe("GameSessionService", () => {
  it("creates one authoritative game and returns viewer-private projections", () => {
    const sessions = new GameSessionService();
    sessions.create("ABCDEF", players, 42);

    const first = sessions.project("ABCDEF", "甲");
    const second = sessions.project("ABCDEF", "乙");

    expect(first.own.id).toBe("甲");
    expect(second.own.id).toBe("乙");
    expect(first.own.faction).not.toBeUndefined();
    expect(first.players.find((player) => player.id === "乙")?.hand).toBeUndefined();
    expect(second.players.find((player) => player.id === "甲")?.hand).toBeUndefined();
    expect(() => sessions.create("ABCDEF", players, 43)).toThrow(
      "房间游戏已经存在",
    );
  });

  it("dispatches commands as the authenticated actor", () => {
    const sessions = new GameSessionService();
    const state = sessions.create("ABCDEF", players, 42);
    const activePlayerId = state.activePlayerId;

    expect(() =>
      sessions.dispatch("ABCDEF", "局外人", { type: "PASS_LOCK" }),
    ).toThrowError(GameSessionError);
    expect(() =>
      sessions.dispatch("ABCDEF", players.find((id) => id !== activePlayerId)!, {
        type: "PASS_LOCK",
      }),
    ).toThrow("当前没有锁定机会");

    const cardId = state.players[activePlayerId].hand[0];
    const card = sessions.project("ABCDEF", activePlayerId).own.hand.find(
      (candidate) => candidate.id === cardId,
    )!;
    const targetId = players.find((id) => id !== activePlayerId)!;
    const projection = sessions.dispatch("ABCDEF", activePlayerId, {
      type: "START_TRANSMISSION",
      cardId,
      ...(card.transmission === "任意" ? { method: "直达" as const } : {}),
      ...(card.transmission === "直达" || card.transmission === "任意"
        ? { targetId }
        : {}),
      ...(card.circle && card.transmission !== "直达"
        ? { direction: "clockwise" as const }
        : {}),
    });

    expect(projection.transmission?.senderId).toBe(activePlayerId);
    expect(sessions.project("ABCDEF", targetId).own.id).toBe(targetId);
  });

  it("dispatches 离间 against 锁定 using the server-generated legal target", () => {
    const sessions = new GameSessionService();
    const state = sessions.create("ABCDEF", players, 240);
    const senderId = state.activePlayerId;
    const senderIndex = state.seatOrder.indexOf(senderId);
    const recipientId = state.seatOrder[(senderIndex + 1) % state.seatOrder.length];
    const reactorId = state.seatOrder[(senderIndex + 2) % state.seatOrder.length];
    const redirectedTargetId = state.seatOrder[(senderIndex + 3) % state.seatOrder.length];
    const intelligence = PHYSICAL_DECK.find(
      (card) => card.transmission === "直达" && card.name !== "锁定",
    )!;
    const lock = PHYSICAL_DECK.find(
      (card) => card.name === "锁定",
    )!;
    const separation = PHYSICAL_DECK.find(
      (card) => card.name === "离间",
    )!;
    for (const card of [intelligence, lock, separation]) detachCard(state, card.id);
    state.players[senderId].hand.push(
      intelligence.id as PhysicalCardId,
      lock.id as PhysicalCardId,
    );
    state.players[reactorId].hand.push(separation.id as PhysicalCardId);

    sessions.dispatch("ABCDEF", senderId, {
      type: "START_TRANSMISSION",
      cardId: intelligence.id as PhysicalCardId,
      targetId: recipientId,
    });
    sessions.dispatch("ABCDEF", senderId, {
      type: "PLAY_LOCK",
      cardId: lock.id as PhysicalCardId,
    });

    expect(sessions.project("ABCDEF", reactorId).legalActions).toContainEqual({
      type: "PLAY_SEPARATION",
      cardId: separation.id,
      targetId: redirectedTargetId,
    });
    sessions.dispatch("ABCDEF", reactorId, {
      type: "PLAY_SEPARATION",
      cardId: separation.id as PhysicalCardId,
      targetId: redirectedTargetId,
    });

    expect(state.transmission).toMatchObject({
      intendedRecipientId: recipientId,
      locked: true,
      lockedRecipientId: redirectedTargetId,
    });
    expect(state.reactionWindow).toMatchObject({
      kind: "lock",
      affectedPlayerId: redirectedTargetId,
    });

    while (state.reactionWindow) {
      const responderId =
        state.reactionWindow.responderOrder[state.reactionWindow.nextResponderIndex];
      sessions.dispatch("ABCDEF", responderId, { type: "PASS_REACTION" });
    }
    expect(sessions.project("ABCDEF", recipientId).legalActions).toEqual([
      { type: "ACCEPT_INTELLIGENCE" },
      { type: "DECLINE_INTELLIGENCE" },
    ]);
    expect(() =>
      sessions.dispatch("ABCDEF", recipientId, {
        type: "ACCEPT_INTELLIGENCE",
      }),
    ).not.toThrow();
    expect(state.players[recipientId].intelligence).toContain(intelligence.id);
  });

  it("dispatches 试探的离间 and offers the original transmission sender for 转移离间", () => {
    const functionSessions = new GameSessionService();
    const functionState = functionSessions.create("ABCDEF", players, 241);
    const functionSourceId = functionState.activePlayerId;
    const sourceIndex = functionState.seatOrder.indexOf(functionSourceId);
    const originalTargetId = functionState.seatOrder[(sourceIndex + 1) % players.length];
    const functionReactorId = functionState.seatOrder[(sourceIndex + 2) % players.length];
    const newFunctionTargetId = functionState.seatOrder[(sourceIndex + 3) % players.length];
    const probe = PHYSICAL_DECK.find(
      (card) => "variant" in card && card.variant?.kind === "probeIdentity",
    )!;
    const functionSeparation = PHYSICAL_DECK.find(
      (card) => card.name === "离间",
    )!;
    for (const card of [probe, functionSeparation]) detachCard(functionState, card.id);
    functionState.players[functionSourceId].hand.push(probe.id as PhysicalCardId);
    functionState.players[functionReactorId].hand.push(
      functionSeparation.id as PhysicalCardId,
    );

    functionSessions.dispatch("ABCDEF", functionSourceId, {
      type: "PLAY_PROBE",
      cardId: probe.id as PhysicalCardId,
      targetId: originalTargetId,
    });
    expect(functionSessions.project("ABCDEF", functionReactorId).legalActions)
      .toContainEqual({
        type: "PLAY_FUNCTION_SEPARATION",
        cardId: functionSeparation.id,
        targetId: newFunctionTargetId,
      });
    functionSessions.dispatch("ABCDEF", functionReactorId, {
      type: "PLAY_FUNCTION_SEPARATION",
      cardId: functionSeparation.id as PhysicalCardId,
      targetId: newFunctionTargetId,
    });
    expect(functionState.activeFunctionAction?.targetPlayerId).toBe(
      newFunctionTargetId,
    );

    const transferSessions = new GameSessionService();
    const transferState = transferSessions.create("GHIJKL", players, 242);
    const senderId = transferState.activePlayerId;
    const senderIndex = transferState.seatOrder.indexOf(senderId);
    const recipientId = transferState.seatOrder[(senderIndex + 1) % players.length];
    const transferTargetId = transferState.seatOrder[(senderIndex + 2) % players.length];
    const transferReactorId = transferState.seatOrder[(senderIndex + 3) % players.length];
    const intelligence = PHYSICAL_DECK.find(
      (card) => card.transmission === "直达",
    )!;
    const transfer = PHYSICAL_DECK.find(
      (card) => card.name === "转移",
    )!;
    const transferSeparation = PHYSICAL_DECK.find(
      (card) => card.name === "离间",
    )!;
    for (const card of [intelligence, transfer, transferSeparation]) {
      detachCard(transferState, card.id);
    }
    transferState.players[senderId].hand.push(intelligence.id as PhysicalCardId);
    transferState.players[recipientId].hand.push(transfer.id as PhysicalCardId);
    transferState.players[transferReactorId].hand.push(
      transferSeparation.id as PhysicalCardId,
    );

    transferSessions.dispatch("GHIJKL", senderId, {
      type: "START_TRANSMISSION",
      cardId: intelligence.id as PhysicalCardId,
      targetId: recipientId,
    });
    transferSessions.dispatch("GHIJKL", senderId, { type: "PASS_LOCK" });
    while (
      transferState.reactionWindow?.responderOrder[
        transferState.reactionWindow.nextResponderIndex
      ] !== recipientId
    ) {
      const responderId = transferState.reactionWindow!.responderOrder[
        transferState.reactionWindow!.nextResponderIndex
      ];
      transferSessions.dispatch("GHIJKL", responderId, {
        type: "PASS_REACTION",
      });
    }
    transferSessions.dispatch("GHIJKL", recipientId, {
      type: "PLAY_TRANSFER",
      cardId: transfer.id as PhysicalCardId,
      targetId: transferTargetId,
    });

    expect(transferSessions.project("GHIJKL", transferReactorId).legalActions)
      .toContainEqual({
        type: "PLAY_SEPARATION",
        cardId: transferSeparation.id,
        targetId: senderId,
      });
    transferSessions.dispatch("GHIJKL", transferReactorId, {
      type: "PLAY_SEPARATION",
      cardId: transferSeparation.id as PhysicalCardId,
      targetId: senderId,
    });
    expect(transferState.transmission?.pendingTransfer?.targetId).toBe(senderId);
  });

  it("keeps private notices after later commands such as automatic passes", () => {
    const sessions = new GameSessionService();
    const state = sessions.create("ABCDEF", players, 142);
    const actorId = state.activePlayerId;
    const noticeCard = PHYSICAL_DECK[0];
    state.privateNotices[actorId].push({
      kind: "dangerousDiscardLost",
      otherPlayerId: players.find((id) => id !== actorId)!,
      cardId: noticeCard.id as PhysicalCardId,
    });

    sessions.dispatch("ABCDEF", actorId, { type: "ENTER_TRANSMISSION_PHASE" });

    expect(sessions.project("ABCDEF", actorId).privateNotices).toContainEqual(
      expect.objectContaining({
        kind: "dangerousDiscardLost",
        card: expect.objectContaining({ id: noticeCard.id }),
      }),
    );
  });

  it("rejects missing sessions with a transport-safe code", () => {
    const sessions = new GameSessionService();
    expect(() => sessions.project("ABCDEF", "甲")).toThrowError(
      expect.objectContaining({ code: "GAME_NOT_FOUND" }),
    );
  });

  it("deletes a completed session so the room can create another game", () => {
    const sessions = new GameSessionService();
    sessions.create("ABCDEF", players, 42);

    expect(sessions.delete("ABCDEF")).toBe(true);
    expect(sessions.has("ABCDEF")).toBe(false);
    expect(() => sessions.create("ABCDEF", players, 43)).not.toThrow();
  });

  it("resolves a host-imposed death through the authoritative engine state", () => {
    const sessions = new GameSessionService();
    const state = sessions.create("ABCDEF", players, 42);
    const targetId = players.find((id) => id !== state.activePlayerId)!;

    const projection = sessions.resolveHostImposedDeath("ABCDEF", targetId);

    expect(state.players[targetId]).toMatchObject({
      alive: false,
      factionRevealed: true,
    });
    expect(projection.players.find((player) => player.id === targetId)).toMatchObject({
      alive: false,
      faction: state.players[targetId].faction,
    });
    expect(() => sessions.resolveHostImposedDeath("ABCDEF", targetId)).toThrow(
      "该玩家已经死亡",
    );
  });

  it("dispatches PLAY_BURN with actor-bound owner and intelligence targets", () => {
    const sessions = new GameSessionService();
    const state = sessions.create("ABCDEF", players, 42);
    const actorId = state.activePlayerId;
    const otherActorId = players.find((id) => id !== actorId)!;
    const targetPlayerId = players.find((id) => id !== actorId && id !== otherActorId)!;
    const burnCard = PHYSICAL_DECK.find((card) => card.name === "烧毁")!;
    const intelligence = PHYSICAL_DECK.find(
      (card) => card.color === "黑" && !card.unburnable && card.id !== burnCard.id,
    )!;
    detachCard(state, burnCard.id);
    detachCard(state, intelligence.id);
    state.players[actorId].hand.push(burnCard.id as PhysicalCardId);
    state.players[targetPlayerId].intelligence.push(
      intelligence.id as PhysicalCardId,
    );
    const command = {
      type: "PLAY_BURN" as const,
      cardId: burnCard.id as PhysicalCardId,
      targetPlayerId,
      targetIntelligenceCardId: intelligence.id as PhysicalCardId,
    };

    expect(() => sessions.dispatch("ABCDEF", otherActorId, command)).toThrow(
      "当前没有可使用烧毁的行动或响应窗口",
    );
    const projection = sessions.dispatch("ABCDEF", actorId, command);
    expect(projection.reactionWindow).toMatchObject({ kind: "burn" });
    expect(state.burnContexts.at(-1)).toMatchObject({
      sourcePlayerId: actorId,
      targetPlayerId,
      targetIntelligenceCardId: intelligence.id,
    });
  });
});

function detachCard(state: GameState, cardId: string): void {
  for (const player of Object.values(state.players)) {
    player.hand = player.hand.filter((id) => id !== cardId);
    player.intelligence = player.intelligence.filter((id) => id !== cardId);
  }
  state.drawPile = state.drawPile.filter((id) => id !== cardId);
  state.publicDiscard = state.publicDiscard.filter((id) => id !== cardId);
}
