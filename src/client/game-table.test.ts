import { describe, expect, it } from "vitest";

import type { PhysicalCard } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import { actionDetail, cardVariantText } from "./GameTable";

const identityProbe = {
  id: "p1-02",
  photo: 1,
  position: 1,
  name: "试探",
  color: "黑",
  transmission: "直达",
  circle: false,
  unburnable: false,
  variant: {
    kind: "probeIdentity",
    mapping: { 军情: "间谍", 潜伏: "卧底", 特工: "好人" },
  },
} satisfies PhysicalCard;

const secretOrder = {
  id: "p1-12",
  photo: 1,
  position: 2,
  name: "秘密下达",
  color: "红",
  transmission: "密电",
  circle: false,
  unburnable: false,
  variant: {
    kind: "secretOrder",
    mapping: { 听风: "红", 看雨: "蓝", 日落: "黑" },
  },
} satisfies PhysicalCard;

const projection = {
  own: { id: "甲", faction: "军情", hand: [identityProbe, secretOrder] },
  players: [{ id: "乙" }],
} as PlayerProjection;

describe("game table card parameters", () => {
  it("shows the printed 试探 and 秘密下达 variants", () => {
    expect(cardVariantText(identityProbe)).toBe("身份代码：军情→间谍 · 潜伏→卧底 · 特工→好人");
    expect(cardVariantText(secretOrder)).toBe("听风→红 · 看雨→蓝 · 日落→黑");
  });

  it("distinguishes the selected action parameters", () => {
    expect(actionDetail(
      { type: "PLAY_PROBE", cardId: "p1-02", targetId: "乙" },
      projection,
      { 乙: "小乙" },
    )).toBe("试探（身份代码） → 小乙");
    expect(actionDetail(
      { type: "PLAY_SECRET_ORDER", cardId: "p1-12", word: "看雨" },
      projection,
      {},
    )).toBe("秘密下达「看雨」");
    expect(actionDetail(
      { type: "CHOOSE_PROBE_IDENTITY", choice: "announce" },
      projection,
      {},
    )).toBe("公开身份代码");
    expect(actionDetail(
      { type: "CHOOSE_PROBE_IDENTITY", choice: "giveRandom" },
      projection,
      {},
    )).toBe("随机交出一张手牌");
  });
});
