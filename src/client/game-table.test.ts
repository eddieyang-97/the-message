import { describe, expect, it } from "vitest";

import type { PhysicalCard } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import {
  actionDetail,
  automaticPassDelayMs,
  automaticPassCommand,
  cardVariantText,
  factionBackgroundClass,
  formatAuditEntries,
  inspectedHandForProjection,
  isNearScrollBottom,
  mergeAuditLogs,
  promptTitle,
  publicTextReceiptEffect,
  responseActionText,
  seatOrderAnchoredAtPlayer,
  transmissionDirectionForSelection,
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

const redPublicText = {
  id: "public-red",
  photo: 1,
  position: 3,
  name: "公开文本",
  color: "红",
  transmission: "文本",
  circle: false,
  unburnable: false,
  variant: { kind: "publicTextColor" },
} satisfies PhysicalCard;

const blackPublicText = {
  ...redPublicText,
  id: "public-black",
  color: "黑",
  variant: { kind: "publicTextBlack", mandatoryDrawFaction: "特工" },
} satisfies PhysicalCard;

const projection = {
  own: { id: "甲", faction: "军情", hand: [identityProbe, secretOrder] },
  players: [{ id: "乙" }],
} as PlayerProjection;

describe("game table card parameters", () => {
  it("shows the printed 试探 and 秘密下达 variants", () => {
    expect(cardVariantText(identityProbe)).toBe("军情→间谍 · 潜伏→卧底 · 特工→好人");
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
    )).toBe("秘密下达：蓝");
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

  it("describes every public-text receipt variant", () => {
    expect(publicTextReceiptEffect(redPublicText)).toBe(
      "潜伏必须弃 1 张；军情／特工选择摸 1 张或弃 1 张",
    );
    expect(publicTextReceiptEffect(blackPublicText)).toBe(
      "特工必须摸 1 张；其他阵营选择摸 1 张或摸 2 张",
    );
    expect(publicTextReceiptEffect(identityProbe)).toBeUndefined();
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

  it("can ignore burn actions without ignoring other available reactions", () => {
    const burnAction = {
      type: "PLAY_BURN" as const,
      cardId: "p1-04" as const,
      targetPlayerId: "乙",
      targetIntelligenceCardId: "p1-05" as const,
    };
    expect(automaticPassCommand([
      { type: "PASS_REACTION" },
      burnAction,
    ])).toBeUndefined();
    expect(automaticPassCommand([
      { type: "PASS_REACTION" },
      burnAction,
    ], true)).toEqual({ type: "PASS_REACTION" });
    expect(automaticPassCommand([
      { type: "PASS_REACTION" },
      burnAction,
      { type: "PLAY_COUNTER", cardId: "p1-03", targetInteractionId: "interaction-1" },
    ], true)).toBeUndefined();
  });

  it("immediately passes only when the player's hand is literally empty", () => {
    expect(automaticPassDelayMs({ type: "PASS_REACTION" }, 0)).toBe(0);
    expect(automaticPassDelayMs({ type: "PASS_REACTION" }, 1)).toBe(1_000);
    expect(automaticPassDelayMs({ type: "PASS_LOCK" })).toBe(0);
  });
});

describe("match log auto-follow", () => {
  it("follows new entries only while the reader remains near the bottom", () => {
    expect(isNearScrollBottom(468, 500, 1_000)).toBe(true);
    expect(isNearScrollBottom(400, 500, 1_000)).toBe(false);
  });
});

describe("current response wording", () => {
  it("describes intelligence as being transmitted rather than used", () => {
    expect(responseActionText({
      id: "intelligence-1",
      kind: "intelligence",
      sourcePlayerId: "甲",
      targetPlayerId: "乙",
    }, { 甲: "小甲" }, "文本")).toBe("【小甲】正在以文本传递情报");
  });

  it("continues to describe function cards as used", () => {
    expect(responseActionText({
      id: "card-1",
      kind: "card",
      sourcePlayerId: "甲",
      targetPlayerId: "乙",
      cardName: "危险情报",
    }, { 甲: "小甲" })).toBe("【小甲】使用 危险情报");
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
        verifiedNoMatch: false,
      },
      legalActions: [],
    })).toBe("请选择要传递的情报");
  });

  it("shows the resolved secret-order color to its target", () => {
    expect(promptTitle({
      ...projection,
      phase: "preTransmission",
      activePlayerId: "甲",
      pendingSecretOrder: {
        stage: "selection",
        targetPlayerId: "甲",
        sourcePlayerId: "乙",
        word: "日落",
        requiredColor: "黑",
        verifiedNoMatch: false,
      },
      legalActions: [],
    })).toBe("秘密下达要求：请选择黑色情报");
  });
});

describe("private hand inspection", () => {
  it("shows the verified hand to the 秘密下达 player after a no-match claim", () => {
    expect(inspectedHandForProjection({
      ...projection,
      pendingSecretOrder: {
        stage: "selection",
        targetPlayerId: "甲",
        sourcePlayerId: "乙",
        word: "听风",
        verifiedNoMatch: true,
        inspectedHand: [identityProbe],
      },
    })).toEqual([identityProbe]);
  });
});

describe("public audit log", () => {
  it("uses the shared server sequence to interleave room and gameplay entries", () => {
    expect(mergeAuditLogs(
      ["stale projection entry"],
      [
        { sequence: 3, timestamp: 30, text: "乙开始以文本传递情报，当前接收者：甲", source: "game" },
        { sequence: 1, timestamp: 10, text: "房间以当前座位开始游戏", source: "room" },
        { sequence: 2, timestamp: 20, text: "游戏初始化完成：2名玩家", source: "game" },
      ],
    )).toEqual([
      "房间以当前座位开始游戏",
      "游戏初始化完成：2名玩家",
      "乙开始以文本传递情报，当前接收者：甲",
    ]);
  });

  it("falls back to the game projection when ordered events are unavailable", () => {
    expect(mergeAuditLogs(["游戏初始化完成：2名玩家"])).toEqual([
      "游戏初始化完成：2名玩家",
    ]);
  });

  it("shows display names instead of internal IDs and keeps chronological order", () => {
    const entries = [
      "0147dd0b开始传递情报",
      "0147dd0b完成与6740294b的公开文本交换",
    ];

    expect(formatAuditEntries(entries, {
      "0147dd0b": "小甲",
      "6740294b": "小乙",
    })).toEqual([
      "【小甲】开始传递情报",
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

describe("duel transmission direction", () => {
  it("omits the meaningless direction choice for circle cards", () => {
    expect(transmissionDirectionForSelection("duel", true, "counterclockwise"))
      .toBeUndefined();
    expect(transmissionDirectionForSelection("standard", true, "counterclockwise"))
      .toBe("counterclockwise");
  });
});
