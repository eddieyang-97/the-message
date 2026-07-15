import { describe, expect, it } from "vitest";

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

  it("rejects missing sessions with a transport-safe code", () => {
    const sessions = new GameSessionService();
    expect(() => sessions.project("ABCDEF", "甲")).toThrowError(
      expect.objectContaining({ code: "GAME_NOT_FOUND" }),
    );
  });
});
