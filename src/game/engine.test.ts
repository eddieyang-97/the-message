import { describe, expect, it } from "vitest";

import { PHYSICAL_DECK } from "./cards";
import {
  assertGameStateInvariants,
  buildDeckForPlayerCount,
  factionsForPlayerCount,
  initializeGame,
  projectGameForPlayer,
} from "./engine";

const standardCounts = [5, 6, 7, 8] as const;

describe("游戏初始化", () => {
  it.each(standardCounts)("为%d名玩家发起始手牌并让首位玩家摸两张", (count) => {
    const ids = Array.from({ length: count }, (_, index) => `玩家${index + 1}`);
    const state = initializeGame(ids, 12345);

    expect(state.mode).toBe("standard");
    expect(state.drawPile).toHaveLength(87 - count * 2 - 2);
    expect(state.players[state.activePlayerId].hand).toHaveLength(4);
    expect(
      Object.values(state.players)
        .filter((player) => player.id !== state.activePlayerId)
        .every((player) => player.hand.length === 2),
    ).toBe(true);
    const allCardIds = [
      ...state.drawPile,
      ...Object.values(state.players).flatMap((player) => player.hand),
    ];
    expect(new Set(allCardIds).size).toBe(87);
    expect(() => assertGameStateInvariants(state)).not.toThrow();
  });

  it("相同种子产生相同牌序和阵营分配", () => {
    const players = ["甲", "乙", "丙", "丁", "戊"];
    const first = initializeGame(players, 20260715);
    const second = initializeGame(players, 20260715);

    expect(second.drawPile).toEqual(first.drawPile);
    expect(second.players).toEqual(first.players);
    expect(second.activePlayerId).toBe(first.activePlayerId);
  });

  it("从全部座位中随机选择首位行动玩家", () => {
    const players = ["甲", "乙", "丙", "丁", "戊"];
    const selected = new Set(
      Array.from({ length: 200 }, (_, seed) =>
        initializeGame(players, seed).activePlayerId,
      ),
    );

    expect(selected).toEqual(new Set(players));
  });

  it.each([
    [2, { 军情: 1, 潜伏: 1, 特工: 0 }],
    [5, { 军情: 2, 潜伏: 2, 特工: 1 }],
    [6, { 军情: 2, 潜伏: 2, 特工: 2 }],
    [7, { 军情: 3, 潜伏: 3, 特工: 1 }],
    [8, { 军情: 3, 潜伏: 3, 特工: 2 }],
  ] as const)("%d名玩家的阵营数量正确", (count, expected) => {
    const factions = factionsForPlayerCount(count);
    const actual = { 军情: 0, 潜伏: 0, 特工: 0 };
    for (const faction of factions) actual[faction] += 1;
    expect(actual).toEqual(expected);
  });

  it.each([0, 1, 3, 4, 9])("拒绝不支持的玩家人数：%d", (count) => {
    const players = Array.from({ length: count }, (_, index) => `${index}`);
    expect(() => initializeGame(players, 1)).toThrow("仅支持2人决斗或5至8人标准游戏");
  });

  it("拒绝当前玩家在传递前没有手牌的状态", () => {
    const state = initializeGame(["甲", "乙", "丙", "丁", "戊"], 88);
    const active = state.players[state.activePlayerId];
    state.drawPile.push(...active.hand);
    active.hand = [];

    expect(() => assertGameStateInvariants(state)).toThrow(
      "当前玩家在传递前必须至少保留一张手牌",
    );
  });
});

describe("双人决斗牌组", () => {
  it("准确过滤为73张且不修改实体牌清单", () => {
    const duelDeck = buildDeckForPlayerCount(2);

    expect(PHYSICAL_DECK).toHaveLength(87);
    expect(duelDeck).toHaveLength(73);
    expect(duelDeck.filter((card) => card.name === "截获")).toHaveLength(0);
    expect(duelDeck.filter((card) => card.name === "离间")).toHaveLength(0);
    expect(
      duelDeck.filter(
        (card) =>
          card.name === "试探" &&
          "variant" in card &&
          card.variant?.kind === "probeIdentity",
      ),
    ).toHaveLength(0);
    expect(
      duelDeck.filter(
        (card) =>
          card.name === "试探" &&
          "variant" in card &&
          card.variant?.kind === "probeDrawDiscard",
      ),
    ).toHaveLength(6);
    expect(new Set(duelDeck.map((card) => card.id)).size).toBe(73);
  });

  it("双人各获两张起始手牌且首位玩家再摸两张", () => {
    const state = initializeGame(["甲", "乙"], 99);

    expect(state.players[state.activePlayerId].hand).toHaveLength(4);
    expect(
      Object.values(state.players).find(
        (player) => player.id !== state.activePlayerId,
      )?.hand,
    ).toHaveLength(2);
    expect(state.drawPile).toHaveLength(67);
    expect(() => assertGameStateInvariants(state)).not.toThrow();
  });
});

describe("玩家私有投影", () => {
  it("只公开查看者自己的阵营、手牌和私有映射", () => {
    const state = initializeGame(["甲", "乙"], 42);
    const ownSecretOrder = state.drawPile.find((id) => {
      const card = PHYSICAL_DECK.find((candidate) => candidate.id === id);
      return card && "variant" in card && card.variant?.kind === "secretOrder";
    });
    const opponentCard = state.drawPile.find((id) => id !== ownSecretOrder);
    if (!ownSecretOrder || !opponentCard) throw new Error("测试牌不存在");

    state.drawPile = state.drawPile.filter(
      (id) => id !== ownSecretOrder && id !== opponentCard,
    );
    state.players["甲"].hand.push(ownSecretOrder);
    state.players["乙"].hand.push(opponentCard);

    const projection = projectGameForPlayer(state, "甲");

    expect(projection.own.faction).toBe(state.players["甲"].faction);
    const projectedSecretOrder = projection.own.hand.find(
      (card) => card.id === ownSecretOrder,
    );
    expect(projectedSecretOrder?.variant?.kind).toBe("secretOrder");
    expect(projection.players.find((player) => player.id === "乙")?.handCount).toBe(
      state.players["乙"].hand.length,
    );
    expect(JSON.stringify(projection)).not.toContain(opponentCard);
    expect(projection.players.every((player) => !("faction" in player))).toBe(true);
  });

  it("不公开抽牌堆中的稳定实体牌ID", () => {
    const state = initializeGame(["甲", "乙", "丙", "丁", "戊"], 7);
    const projection = projectGameForPlayer(state, "甲");

    expect(projection.drawPileCount).toBe(75);
    expect(JSON.stringify(projection)).not.toContain(state.drawPile[0]);
  });
});
