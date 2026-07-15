import { describe, expect, it } from "vitest";

import {
  EXPECTED_DECK_TOTALS,
  PHYSICAL_DECK,
  assertPhysicalDeckIntegrity,
  type CardColor,
  type Faction,
  type PhysicalCard,
  type SecretOrderWord,
} from "./cards";

const countBy = <K extends PropertyKey>(
  cards: readonly PhysicalCard[],
  keyOf: (card: PhysicalCard) => K,
): Map<K, number> => {
  const counts = new Map<K, number>();
  for (const card of cards) {
    const key = keyOf(card);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

describe("实体牌组清单", () => {
  it("通过基础完整性校验", () => {
    expect(() => assertPhysicalDeckIntegrity()).not.toThrow();
  });

  it("拥有87个唯一实体牌ID", () => {
    expect(PHYSICAL_DECK).toHaveLength(87);
    expect(new Set(PHYSICAL_DECK.map((card) => card.id)).size).toBe(87);
  });

  it("颜色总数为红21、蓝21、黑42、红蓝3", () => {
    const counts = countBy(PHYSICAL_DECK, (card) => card.color);

    expect(Object.fromEntries(counts)).toEqual(
      EXPECTED_DECK_TOTALS.colors,
    );
  });

  it("带圈牌总数为28", () => {
    expect(PHYSICAL_DECK.filter((card) => card.circle)).toHaveLength(28);
  });

  it("每张照片中的位置连续且不重复", () => {
    const expectedLengths = new Map([
      [1, 12],
      [2, 15],
      [3, 15],
      [4, 15],
      [5, 15],
      [6, 15],
    ]);

    for (const [photo, expectedLength] of expectedLengths) {
      const positions = PHYSICAL_DECK
        .filter((card) => card.photo === photo)
        .map((card) => card.position)
        .sort((a, b) => a - b);

      expect(positions).toEqual(
        Array.from({ length: expectedLength }, (_, index) => index + 1),
      );
    }
  });
});

describe("规则相关结构约束", () => {
  it("三张机密文件均为红蓝双色直达且无圈", () => {
    const cards = PHYSICAL_DECK.filter((card) => card.name === "机密文件");

    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.color).toBe("红蓝");
      expect(card.transmission).toBe("直达");
      expect(card.circle).toBe(false);
    }
  });

  it("五张危险情报均为黑色任意传递", () => {
    const cards = PHYSICAL_DECK.filter((card) => card.name === "危险情报");

    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card.color).toBe("黑");
      expect(card.transmission).toBe("任意");
    }
  });

  it("九张秘密下达按颜色3/3/3分布且映射均为完整排列", () => {
    const cards = PHYSICAL_DECK.filter((card) => card.name === "秘密下达");
    const colorCounts = countBy(cards, (card) => card.color);
    const words: readonly SecretOrderWord[] = ["听风", "看雨", "日落"];
    const colors: readonly CardColor[] = ["红", "蓝", "黑"];

    expect(cards).toHaveLength(9);
    expect(colorCounts.get("红")).toBe(3);
    expect(colorCounts.get("蓝")).toBe(3);
    expect(colorCounts.get("黑")).toBe(3);

    for (const card of cards) {
      expect(card.transmission).toBe("直达");
      expect(card.circle).toBe(false);
      expect(card.variant?.kind).toBe("secretOrder");

      if (card.variant?.kind !== "secretOrder") {
        throw new Error(`${card.id} 缺少秘密下达映射`);
      }

      expect(Object.keys(card.variant.mapping).sort()).toEqual(
        [...words].sort(),
      );
      expect(Object.values(card.variant.mapping).sort()).toEqual(
        [...colors].sort(),
      );
    }
  });

  it("九张试探由三张身份型和六张抽弃型组成", () => {
    const cards = PHYSICAL_DECK.filter((card) => card.name === "试探");
    const identityCards = cards.filter(
      (card) => card.variant?.kind === "probeIdentity",
    );
    const drawDiscardCards = cards.filter(
      (card) => card.variant?.kind === "probeDrawDiscard",
    );

    expect(cards).toHaveLength(9);
    expect(cards.every((card) => card.color === "黑")).toBe(true);
    expect(identityCards).toHaveLength(3);
    expect(drawDiscardCards).toHaveLength(6);
    expect(identityCards.every((card) => card.transmission === "直达")).toBe(
      true,
    );
    expect(drawDiscardCards.every((card) => card.transmission === "密电")).toBe(
      true,
    );
  });

  it("逐牌记录七张不可烧毁牌，不依赖运行时牌族推断", () => {
    const confirmedIds = [
      "p2-06",
      "p3-01",
      "p3-05",
      "p3-09",
      "p4-15",
      "p5-13",
      "p6-05",
    ] as const;
    const markedCards = PHYSICAL_DECK.filter((card) => card.unburnable);

    expect(markedCards.map((card) => card.id)).toEqual(confirmedIds);
    expect(PHYSICAL_DECK.every((card) => typeof card.unburnable === "boolean")).toBe(
      true,
    );
    expect(markedCards.every((card) =>
      card.name === "危险情报" ||
      (card.name === "掉包" && card.color === "黑") ||
      (card.name === "锁定" && card.color === "黑" && card.transmission === "直达")
    )).toBe(true);
    const physicallyMarkedCards = PHYSICAL_DECK.filter((card) =>
      card.name === "危险情报" ||
      (card.name === "掉包" && card.color === "黑") ||
      (card.name === "锁定" && card.color === "黑" && card.transmission === "直达")
    );
    expect(physicallyMarkedCards.map((card) => card.id)).toEqual(confirmedIds);
  });

  it("抽弃型试探中三个阵营各有一张带圈和一张不带圈", () => {
    const factions: readonly Faction[] = ["军情", "潜伏", "特工"];

    for (const faction of factions) {
      const cards = PHYSICAL_DECK.filter(
        (card) =>
          card.name === "试探" &&
          card.variant?.kind === "probeDrawDiscard" &&
          card.variant.drawFaction === faction,
      );

      expect(cards).toHaveLength(2);
      expect(cards.filter((card) => card.circle)).toHaveLength(1);
      expect(cards.filter((card) => !card.circle)).toHaveLength(1);
    }
  });

  it("破译、锁定、截获、识破、调虎离山各颜色均有一张带圈", () => {
    const families = ["破译", "锁定", "截获", "识破", "调虎离山"] as const;
    const colors = ["红", "蓝", "黑"] as const;

    for (const name of families) {
      for (const color of colors) {
        const circleCards = PHYSICAL_DECK.filter(
          (card) =>
            card.name === name && card.color === color && card.circle,
        );
        expect(
          circleCards,
          `${name} ${color}应恰有一张带圈`,
        ).toHaveLength(1);
      }
    }
  });

  it("离间为红1、蓝1、黑3，全部直达且无圈", () => {
    const cards = PHYSICAL_DECK.filter((card) => card.name === "离间");
    const counts = countBy(cards, (card) => card.color);

    expect(cards).toHaveLength(5);
    expect(counts.get("红")).toBe(1);
    expect(counts.get("蓝")).toBe(1);
    expect(counts.get("黑")).toBe(3);
    expect(cards.every((card) => card.transmission === "直达")).toBe(true);
    expect(cards.every((card) => !card.circle)).toBe(true);
  });

  it("增援为红蓝黑各一张，全部直达且无圈", () => {
    const cards = PHYSICAL_DECK.filter((card) => card.name === "增援");
    const counts = countBy(cards, (card) => card.color);

    expect(cards).toHaveLength(3);
    expect(counts.get("红")).toBe(1);
    expect(counts.get("蓝")).toBe(1);
    expect(counts.get("黑")).toBe(1);
    expect(cards.every((card) => card.transmission === "直达")).toBe(true);
    expect(cards.every((card) => !card.circle)).toBe(true);
  });
});
