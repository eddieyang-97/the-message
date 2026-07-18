import { useLayoutEffect, useRef, useState } from "react";

import type { PlayerReactionEvent, PlayerReactionKind } from "../social-reactions";
import "./player-reactions.css";

interface PositionedReaction extends PlayerReactionEvent {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  controlX: number;
  controlY: number;
}

export interface PlayerReactionLayerProps {
  events: readonly PlayerReactionEvent[];
  playerDisplayNames?: Readonly<Record<string, string>>;
}

export interface PlayerReactionMenuProps {
  targetName: string;
  canChooseGameTarget: boolean;
  disabled?: boolean;
  onChooseGameTarget: () => void;
  onReact: (kind: PlayerReactionKind) => void;
  onClose: () => void;
}

export function PlayerReactionMenu({
  targetName,
  canChooseGameTarget,
  disabled = false,
  onChooseGameTarget,
  onReact,
  onClose,
}: PlayerReactionMenuProps) {
  return (
    <div aria-label={`与${targetName}互动`} className="player-reaction-menu" role="menu">
      {canChooseGameTarget && (
        <button disabled={disabled} onClick={onChooseGameTarget} role="menuitem" type="button">
          选择为目标
        </button>
      )}
      <button disabled={disabled} onClick={() => onReact("flower")} role="menuitem" type="button">
        <span aria-hidden="true">🌹</span> 送花
      </button>
      <button disabled={disabled} onClick={() => onReact("tomato")} role="menuitem" type="button">
        <span aria-hidden="true">🍅</span> 扔番茄
      </button>
      <button className="player-reaction-menu__close" onClick={onClose} role="menuitem" type="button">
        取消
      </button>
    </div>
  );
}

function reactionEndpoint(
  playerId: string,
  endpoint: "source" | "target",
): { x: number; y: number } | undefined {
  const attribute = endpoint === "source"
    ? "data-reaction-source-player-id"
    : "data-reaction-target-player-id";
  const element = [...document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .find((candidate) => candidate.getAttribute(attribute) === playerId);
  if (!element) return undefined;
  const bounds = element.getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

export function playerReactionLabel(
  event: PlayerReactionEvent,
  playerDisplayNames: Readonly<Record<string, string>> = {},
): string {
  const sender = playerDisplayNames[event.fromPlayerId] ?? event.fromPlayerId;
  const target = playerDisplayNames[event.targetPlayerId] ?? event.targetPlayerId;
  return event.kind === "flower"
    ? `${sender}向${target}送了一朵花`
    : `${sender}向${target}扔了一个番茄`;
}

export function PlayerReactionLayer({
  events,
  playerDisplayNames = {},
}: PlayerReactionLayerProps) {
  const seenIds = useRef(new Set<string>());
  const [active, setActive] = useState<PositionedReaction[]>([]);

  useLayoutEffect(() => {
    const retainedIds = new Set(events.map((event) => event.id));
    for (const seenId of seenIds.current) {
      if (!retainedIds.has(seenId)) seenIds.current.delete(seenId);
    }
    const additions = events.flatMap((event) => {
      if (seenIds.current.has(event.id)) return [];
      seenIds.current.add(event.id);
      const start = reactionEndpoint(event.fromPlayerId, "source");
      const end = reactionEndpoint(event.targetPlayerId, "target");
      return start && end
        ? [{
            ...event,
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
            controlX: (start.x + end.x) / 2,
            controlY: (start.y + end.y) / 2 - (event.kind === "flower" ? 80 : 95),
          }]
        : [];
    });
    if (additions.length > 0) setActive((current) => [...current, ...additions]);
  }, [events]);

  return (
    <div aria-live="polite" className="player-reaction-layer">
      {active.map((event) => (
        <div
          aria-label={playerReactionLabel(event, playerDisplayNames)}
          className={`player-reaction player-reaction--${event.kind}`}
          key={event.id}
          role="status"
          style={{
            "--reaction-start-x": `${event.startX}px`,
            "--reaction-start-y": `${event.startY}px`,
            "--reaction-end-x": `${event.endX}px`,
            "--reaction-end-y": `${event.endY}px`,
            "--reaction-control-x": `${event.controlX}px`,
            "--reaction-control-y": `${event.controlY}px`,
          } as React.CSSProperties}
        >
          <span className="player-reaction__projectile" aria-hidden="true">
            {event.kind === "flower" ? "🌹" : "🍅"}
          </span>
          <span
            className="player-reaction__impact"
            aria-hidden="true"
            onAnimationEnd={() => setActive((current) =>
              current.filter((candidate) => candidate.id !== event.id)
            )}
          >
            {event.kind === "flower" ? "🌸" : "💥"}
          </span>
        </div>
      ))}
    </div>
  );
}
