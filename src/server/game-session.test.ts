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
