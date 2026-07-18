import { describe, expect, it } from "vitest";

import { isPlayerReactionKind } from "../social-reactions";
import { playerReactionLabel } from "./PlayerReactionLayer";

describe("玩家互动", () => {
  it("只接受送花和番茄两种互动", () => {
    expect(isPlayerReactionKind("flower")).toBe(true);
    expect(isPlayerReactionKind("tomato")).toBe(true);
    expect(isPlayerReactionKind("chat")).toBe(false);
  });

  it("生成中文无障碍提示", () => {
    expect(playerReactionLabel({
      id: "reaction-1",
      kind: "flower",
      fromPlayerId: "甲",
      targetPlayerId: "乙",
    }, { 甲: "Eddie", 乙: "朋友" })).toBe("Eddie向朋友送了一朵花");
  });
});
