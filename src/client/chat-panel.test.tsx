import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatPanel, insertChatEmoji, messagesAfterSequence } from "./ChatPanel";

const messages = [
  { sequence: 1, playerId: "甲", text: "第一条", sentAt: 1_000 },
  { sequence: 2, playerId: "乙", text: "第二条", sentAt: 2_000 },
];

describe("局内聊天面板", () => {
  it("按序列识别新消息供玩家气泡使用", () => {
    expect(messagesAfterSequence(messages, 1)).toEqual([messages[1]]);
  });

  it("在光标位置插入表情并替换选区", () => {
    expect(insertChatEmoji("你好世界", "😊", 2, 2)).toBe("你好😊世界");
    expect(insertChatEmoji("你好世界", "🌹", 2, 4)).toBe("你好🌹");
  });

  it("玩家和旁观者都能看到历史和输入框", () => {
    const playerMarkup = renderToStaticMarkup(
      <ChatPanel
        connected
        messages={messages}
        onSend={() => {}}
        playerDisplayNames={{ 甲: "Eddie", 乙: "玩家乙" }}
      />,
    );
    expect(playerMarkup).toContain("Eddie");
    expect(playerMarkup).toContain("第二条");
    expect(playerMarkup).toContain("聊天消息");
    expect(playerMarkup).toContain("选择表情");

    const spectatorMarkup = renderToStaticMarkup(
      <ChatPanel
        connected
        messages={messages}
        onSend={() => {}}
        playerDisplayNames={{ 甲: "Eddie", 乙: "玩家乙" }}
      />,
    );
    expect(spectatorMarkup).toContain("聊天消息");
    expect(spectatorMarkup).toContain("第一条");
  });
});
