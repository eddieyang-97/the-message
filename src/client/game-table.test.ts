import { describe, expect, it } from "vitest";

import type { PhysicalCard } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import {
  actionDetail,
  automaticPassCommand,
  cardVariantText,
  factionBackgroundClass,
  formatAuditEntries,
  promptTitle,
  seatOrderAnchoredAtPlayer,
} from "./GameTable";

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

describe("own faction background", () => {
  it("uses a distinct background class for every faction", () => {
    expect(factionBackgroundClass("军情")).toBe("game-shell--faction-intelligence");
    expect(factionBackgroundClass("潜伏")).toBe("game-shell--faction-undercover");
    expect(factionBackgroundClass("特工")).toBe("game-shell--faction-agent");
  });
});

describe("automatic reaction passing", () => {
  it("passes only when PASS_REACTION or PASS_LOCK is the sole legal action", () => {
    expect(automaticPassCommand([{ type: "PASS_REACTION" }])).toEqual({
      type: "PASS_REACTION",
    });
    expect(automaticPassCommand([{ type: "PASS_LOCK" }])).toEqual({
      type: "PASS_LOCK",
    });
    expect(automaticPassCommand([])).toBeUndefined();
    expect(automaticPassCommand([
      { type: "PASS_REACTION" },
      { type: "PLAY_COUNTER", cardId: "p1-03", targetInteractionId: "interaction-1" },
    ])).toBeUndefined();
    expect(automaticPassCommand([
      { type: "PASS_LOCK" },
      { type: "PLAY_LOCK", cardId: "p1-03" },
    ])).toBeUndefined();
  });
});

describe("transmission prompt", () => {
  it("asks the active player to select intelligence after secret-order polling", () => {
    expect(promptTitle({
      ...projection,
      phase: "preTransmission",
      activePlayerId: "甲",
      pendingSecretOrder: {
        stage: "selection",
        targetPlayerId: "甲",
      },
      legalActions: [],
    })).toBe("请选择要传递的情报");
  });
});

describe("public audit log", () => {
  it("shows display names instead of internal IDs and keeps chronological order", () => {
    const entries = [
      "0147dd0b放弃响应",
      "0147dd0b完成与6740294b的公开文本交换",
    ];

    expect(formatAuditEntries(entries, {
      "0147dd0b": "小甲",
      "6740294b": "小乙",
    })).toEqual([
      "【小甲】放弃响应",
      "【小甲】完成与【小乙】的公开文本交换",
    ]);
  });
});

describe("viewer-relative seat layout", () => {
  it("anchors the current player first while preserving clockwise order", () => {
    expect(seatOrderAnchoredAtPlayer(["甲", "乙", "丙", "丁", "戊"], "丙"))
      .toEqual(["丙", "丁", "戊", "甲", "乙"]);
    expect(seatOrderAnchoredAtPlayer(["甲", "乙"], "乙")).toEqual(["乙", "甲"]);
  });
});
