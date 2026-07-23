import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useState,
} from "react";

const SIDEBAR_RATIO_STORAGE_KEY = "fengsheng:game-sidebar-log-ratio";
const MIN_SIDEBAR_RATIO = 0.25;
const MAX_SIDEBAR_RATIO = 0.75;
const SIDEBAR_RATIO_STEP = 0.05;

export const DEFAULT_SIDEBAR_RATIO = 0.5;

export function clampSidebarRatio(ratio: number): number {
  return Math.min(MAX_SIDEBAR_RATIO, Math.max(MIN_SIDEBAR_RATIO, ratio));
}

export function sidebarRatioFromPointer(
  clientY: number,
  sidebarTop: number,
  sidebarHeight: number,
): number {
  if (sidebarHeight <= 0) {
    return DEFAULT_SIDEBAR_RATIO;
  }
  return clampSidebarRatio((clientY - sidebarTop) / sidebarHeight);
}

export function sidebarRatioForKey(currentRatio: number, key: string): number | undefined {
  if (key === "ArrowUp") {
    return clampSidebarRatio(currentRatio - SIDEBAR_RATIO_STEP);
  }
  if (key === "ArrowDown") {
    return clampSidebarRatio(currentRatio + SIDEBAR_RATIO_STEP);
  }
  if (key === "Home") {
    return MIN_SIDEBAR_RATIO;
  }
  if (key === "End") {
    return MAX_SIDEBAR_RATIO;
  }
  return undefined;
}

function loadSavedSidebarRatio(): number {
  try {
    const savedRatio = Number.parseFloat(localStorage.getItem(SIDEBAR_RATIO_STORAGE_KEY) ?? "");
    return Number.isFinite(savedRatio) ? clampSidebarRatio(savedRatio) : DEFAULT_SIDEBAR_RATIO;
  } catch {
    return DEFAULT_SIDEBAR_RATIO;
  }
}

function saveSidebarRatio(ratio: number): void {
  try {
    localStorage.setItem(SIDEBAR_RATIO_STORAGE_KEY, String(ratio));
  } catch {
    // The layout remains adjustable when storage is unavailable.
  }
}

export interface ResizableGameSidebarProps {
  auditPanel: ReactNode;
  chatPanel: ReactNode;
}

export function ResizableGameSidebar({
  auditPanel,
  chatPanel,
}: ResizableGameSidebarProps) {
  const [auditRatio, setAuditRatio] = useState(loadSavedSidebarRatio);
  const sidebarRef = useRef<HTMLElement>(null);
  const draggingPointerId = useRef<number | undefined>(undefined);

  const ratioFromPointer = (clientY: number): number | undefined => {
    const bounds = sidebarRef.current?.getBoundingClientRect();
    if (!bounds) {
      return undefined;
    }
    return sidebarRatioFromPointer(clientY, bounds.top, bounds.height);
  };

  const updateFromPointer = (clientY: number) => {
    const nextRatio = ratioFromPointer(clientY);
    if (nextRatio !== undefined) {
      setAuditRatio(nextRatio);
    }
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPointerId.current !== event.pointerId) {
      return;
    }
    const nextRatio = ratioFromPointer(event.clientY);
    if (nextRatio !== undefined) {
      setAuditRatio(nextRatio);
      saveSidebarRatio(nextRatio);
    }
    draggingPointerId.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingPointerId.current !== event.pointerId) {
      return;
    }
    draggingPointerId.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    saveSidebarRatio(auditRatio);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextRatio = sidebarRatioForKey(auditRatio, event.key);
    if (nextRatio === undefined) {
      return;
    }
    event.preventDefault();
    setAuditRatio(nextRatio);
    saveSidebarRatio(nextRatio);
  };

  const auditPercentage = Math.round(auditRatio * 100);
  const sidebarStyle = {
    "--game-sidebar-audit-ratio": `${auditRatio}fr`,
    "--game-sidebar-chat-ratio": `${1 - auditRatio}fr`,
  } as CSSProperties;

  return (
    <aside className="game-sidebar" ref={sidebarRef} style={sidebarStyle}>
      {auditPanel}
      <div
        aria-label="调整公开记录与聊天的高度"
        aria-orientation="horizontal"
        aria-valuemax={Math.round(MAX_SIDEBAR_RATIO * 100)}
        aria-valuemin={Math.round(MIN_SIDEBAR_RATIO * 100)}
        aria-valuenow={auditPercentage}
        aria-valuetext={`公开记录 ${auditPercentage}%，聊天 ${100 - auditPercentage}%`}
        className="game-sidebar__splitter"
        onDoubleClick={() => {
          setAuditRatio(DEFAULT_SIDEBAR_RATIO);
          saveSidebarRatio(DEFAULT_SIDEBAR_RATIO);
        }}
        onKeyDown={handleKeyDown}
        onPointerCancel={cancelDrag}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          draggingPointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateFromPointer(event.clientY);
        }}
        onPointerMove={(event) => {
          if (draggingPointerId.current === event.pointerId) {
            updateFromPointer(event.clientY);
          }
        }}
        onPointerUp={finishDrag}
        role="separator"
        tabIndex={0}
        title="拖动调整高度，双击恢复一半"
      />
      {chatPanel}
    </aside>
  );
}
