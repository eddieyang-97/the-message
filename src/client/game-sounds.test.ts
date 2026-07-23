import { describe, expect, it } from "vitest";

import {
  playerReactionSoundPhase,
  soundCueForAuditEntries,
  winnerSoundCue,
} from "./game-sounds";

describe("game sound cues", () => {
  it("plays flowers immediately but waits for tomato impact", () => {
    expect(playerReactionSoundPhase("flower")).toBe("immediate");
    expect(playerReactionSoundPhase("tomato")).toBe("impact");
  });

  it("classifies the main public game events by priority", () => {
    expect(soundCueForAuditEntries(["甲回合开始并摸2张牌"])).toBe("draw");
    expect(soundCueForAuditEntries(["甲使用锁定"])).toBe("play");
    expect(
      soundCueForAuditEntries([
        "乙拒绝情报，当前接收者：丙",
      ]),
    ).toBe("pass");
    expect(
      soundCueForAuditEntries([
        "丁使用截获，成为当前接收者",
      ]),
    ).toBe("pass");
    expect(soundCueForAuditEntries(["乙接收情报：「截获（黑 · 密电）」"])).toBe(
      "receive",
    );
    expect(
      soundCueForAuditEntries([
        "丙使用烧毁",
        "烧毁结算：乙的黑色情报被公开弃置",
      ]),
    ).toBe("burn");
    expect(soundCueForAuditEntries(["甲放弃响应"])).toBeUndefined();
  });

  it("uses the private player identity for the end-game cue", () => {
    const own = { id: "甲", faction: "军情" as const, hand: [] };
    expect(winnerSoundCue({ kind: "faction", faction: "军情" }, own)).toBe(
      "victory",
    );
    expect(winnerSoundCue({ kind: "faction", faction: "潜伏" }, own)).toBe(
      "defeat",
    );
    expect(winnerSoundCue({ kind: "agent", playerId: "甲" }, own)).toBe(
      "victory",
    );
  });
});
