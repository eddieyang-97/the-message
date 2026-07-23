import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  clampSidebarRatio,
  ResizableGameSidebar,
  sidebarRatioForKey,
  sidebarRatioFromPointer,
} from "./ResizableGameSidebar";

describe("公开记录与聊天高度调整", () => {
  it("将拖动比例限制在两侧都可用的范围内", () => {
    expect(clampSidebarRatio(0.1)).toBe(0.25);
    expect(clampSidebarRatio(0.6)).toBe(0.6);
    expect(clampSidebarRatio(0.9)).toBe(0.75);
    expect(sidebarRatioFromPointer(350, 100, 500)).toBe(0.5);
  });

  it("支持键盘微调和快速跳到边界", () => {
    expect(sidebarRatioForKey(0.5, "ArrowUp")).toBeCloseTo(0.45);
    expect(sidebarRatioForKey(0.5, "ArrowDown")).toBeCloseTo(0.55);
    expect(sidebarRatioForKey(0.5, "Home")).toBe(0.25);
    expect(sidebarRatioForKey(0.5, "End")).toBe(0.75);
    expect(sidebarRatioForKey(0.5, "Enter")).toBeUndefined();
  });

  it("提供可访问的水平分隔条和默认比例", () => {
    const markup = renderToStaticMarkup(
      <ResizableGameSidebar
        auditPanel={<section>公开记录内容</section>}
        chatPanel={<section>聊天内容</section>}
      />,
    );

    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-label="调整公开记录与聊天的高度"');
    expect(markup).toContain('aria-valuenow="50"');
    expect(markup).toContain("拖动调整高度，双击恢复一半");
  });
});
