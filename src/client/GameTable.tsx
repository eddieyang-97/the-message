import { useEffect, useMemo, useRef, useState } from "react";

import type { Faction, PhysicalCard, PhysicalCardId } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import type { ChatMessageSnapshot, PublicAuditEvent } from "../room";
import type { GameCommand, ReactionTimerSnapshot } from "../server";
import type { PlayerReactionEvent, PlayerReactionKind } from "../social-reactions";
import { ChatPanel, PlayerChatBubble, usePlayerChatBubbles } from "./ChatPanel";
import { DiscardPileButton, DiscardPileDialog } from "./DiscardPile";
import { PlayerReactionLayer, PlayerReactionMenu } from "./PlayerReactionLayer";
import {
  AUTO_PASS_DELAY_OPTIONS_MS,
  REACTION_TIMEOUT_OPTIONS,
  type AutoPassDelayMs,
  type ReactionTimeoutSeconds,
} from "./lobby-types";
import "./game-table.css";

export type ProjectedLegalAction = PlayerProjection["legalActions"][number];
type BurnCommand = Extract<GameCommand, { type: "PLAY_BURN" }>;
type ProjectedReactionKind = NonNullable<PlayerProjection["reactionWindow"]>["kind"];
type ProjectedReceiptStage = NonNullable<PlayerProjection["transmission"]>["receiptStage"];
export type IdentityMarker = "" | Faction;

export interface GameTableProps {
  projection: PlayerProjection;
  playerDisplayNames?: Readonly<Record<string, string>>;
  connected: boolean;
  busy?: boolean;
  errorMessage?: string;
  reactionTimer?: ReactionTimerSnapshot | null;
  isHost?: boolean;
  reactionTimeoutSeconds: ReactionTimeoutSeconds;
  autoPassDelayMs: AutoPassDelayMs;
  publicAuditEvents?: readonly PublicAuditEvent[];
  chatMessages?: readonly ChatMessageSnapshot[];
  playerReactions?: readonly PlayerReactionEvent[];
  spectators?: readonly { id: string; displayName: string; connected: boolean }[];
  disconnectedLivingPlayers?: readonly {
    id: string;
    displayName: string;
    botControlled: boolean;
  }[];
  onReactionTimeoutChange: (seconds: ReactionTimeoutSeconds) => void;
  onAutoPassDelayChange: (milliseconds: AutoPassDelayMs) => void;
  onMarkDisconnectedPlayerDead: (playerId: string) => void;
  onSetBotTakeover: (playerId: string, enabled: boolean) => void;
  onNewGame: () => void;
  onSendChat: (text: string) => void;
  onPlayerReaction: (kind: PlayerReactionKind, targetPlayerId: string) => void;
  onCommand: (command: GameCommand) => void;
}

const AUTO_PASS_STORAGE_KEY = "fengsheng:auto-pass-no-action";
const AUTO_PASS_IGNORE_BURN_STORAGE_KEY = "fengsheng:auto-pass-ignore-burn";

export function automaticPassCommand(
  actions: readonly ProjectedLegalAction[],
  ignoreBurn = false,
): Extract<GameCommand, { type: "PASS_REACTION" | "PASS_LOCK" }> | undefined {
  const relevantActions = ignoreBurn
    ? actions.filter((action) => action.type !== "PLAY_BURN")
    : actions;
  if (relevantActions.length !== 1) return undefined;
  const action = relevantActions[0];
  return action?.type === "PASS_REACTION" || action?.type === "PASS_LOCK"
    ? action
    : undefined;
}

export function automaticPassDelayMs(
  action: Extract<GameCommand, { type: "PASS_REACTION" | "PASS_LOCK" }>,
  handCount = 0,
  configuredDelayMs: AutoPassDelayMs = 1_000,
): number {
  if (action.type === "PASS_LOCK") return 0;
  return handCount === 0 ? 0 : configuredDelayMs;
}

export function isNearScrollBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 32,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

function loadAutoPassPreference(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_PASS_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function loadAutoPassIgnoreBurnPreference(): boolean {
  try {
    const stored = localStorage.getItem(AUTO_PASS_IGNORE_BURN_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function ReactionCountdown({ timer }: { timer: ReactionTimerSnapshot }) {
  const [now, setNow] = useState(() => performance.now());
  const [localDeadline, setLocalDeadline] = useState(
    () => performance.now() + timer.remainingMs,
  );

  useEffect(() => {
    const receivedAt = performance.now();
    setNow(receivedAt);
    setLocalDeadline(receivedAt + timer.remainingMs);
    if (timer.paused) return;
    const interval = window.setInterval(() => setNow(performance.now()), 250);
    return () => window.clearInterval(interval);
  }, [timer.paused, timer.promptId, timer.remainingMs]);

  const remainingMs = timer.paused
    ? timer.remainingMs
    : Math.max(0, localDeadline - now);
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return (
    <span className={`reaction-countdown${timer.paused ? " reaction-countdown--paused" : ""}`}>
      {timer.paused ? `计时暂停 · ${remainingSeconds} 秒` : `${remainingSeconds} 秒`}
    </span>
  );
}

function responseActionLabel(
  item: PlayerProjection["responseStack"][number],
): string {
  if (item.kind === "intelligence") return "传递情报";
  if (item.kind === "secretOrderWindow") return "秘密下达窗口";
  return item.cardName ?? "卡牌行动";
}

export function responseActionText(
  item: PlayerProjection["responseStack"][number],
  playerDisplayNames: Readonly<Record<string, string>>,
  transmissionMethod?: NonNullable<PlayerProjection["transmission"]>["method"],
): string {
  if (item.kind === "intelligence") {
    const sender = item.sourcePlayerId
      ? `【${playerDisplayNames[item.sourcePlayerId] ?? item.sourcePlayerId}】`
      : "";
    return `${sender}正在${transmissionMethod ? `以${transmissionMethod}` : ""}传递情报`;
  }
  return item.sourcePlayerId
    ? `【${playerDisplayNames[item.sourcePlayerId] ?? item.sourcePlayerId}】使用 ${responseActionLabel(item)}`
    : responseActionLabel(item);
}

function ResponsePanel({
  projection,
  playerDisplayNames,
  reactionTimer,
  offset,
  onOffsetChange,
}: {
  projection: PlayerProjection;
  playerDisplayNames: Readonly<Record<string, string>>;
  reactionTimer?: ReactionTimerSnapshot | null;
  offset: { x: number; y: number };
  onOffsetChange: (offset: { x: number; y: number }) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | undefined>(undefined);
  const stack = projection.responseStack;
  const current = stack.at(-1);
  if (!projection.reactionWindow || !current) return null;
  const currentResponder = projection.reactionWindow.currentResponderId;

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const margin = 8;
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      minX: offset.x + margin - rect.left,
      maxX: offset.x + window.innerWidth - margin - rect.right,
      minY: offset.y + margin - rect.top,
      maxY: offset.y + window.innerHeight - margin - rect.bottom,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    onOffsetChange({
      x: Math.min(active.maxX, Math.max(active.minX, active.originX + event.clientX - active.startX)),
      y: Math.min(active.maxY, Math.max(active.minY, active.originY + event.clientY - active.startY)),
    });
  };

  const stopDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      className="response-panel"
      aria-label="当前响应"
      ref={panelRef}
      style={{ "--response-offset-x": `${offset.x}px`, "--response-offset-y": `${offset.y}px` } as React.CSSProperties}
    >
      <div
        className="response-panel__heading"
        onDoubleClick={() => onOffsetChange({ x: 0, y: 0 })}
        onPointerCancel={stopDrag}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        title="拖动调整位置；双击复位"
      >
        <span>当前响应 <i aria-hidden="true">⠿</i></span>
        {reactionTimer && <ReactionCountdown key={reactionTimer.promptId} timer={reactionTimer} />}
      </div>
      <strong className="response-panel__action">
        {responseActionText(current, playerDisplayNames, projection.transmission?.method)}
      </strong>
      <span className="response-panel__target">
        目标：【{playerDisplayNames[current.targetPlayerId] ?? current.targetPlayerId}】
      </span>
      {stack.length > 1 && (
        <ol className="response-stack">
          {stack.map((item, index) => (
            <li className={index === stack.length - 1 ? "response-stack__current" : ""} key={item.id}>
              <span>{item.sourcePlayerId ? `【${playerDisplayNames[item.sourcePlayerId] ?? item.sourcePlayerId}】` : ""}{responseActionLabel(item)}</span>
              {index === stack.length - 1 && <em>← 当前响应</em>}
            </li>
          ))}
        </ol>
      )}
      <small>等待：【{playerDisplayNames[currentResponder] ?? currentResponder}】响应</small>
    </section>
  );
}

const ACTION_LABELS: Record<string, string> = {
  ACCEPT_INTELLIGENCE: "接收情报",
  DECLINE_INTELLIGENCE: "不接收",
  DISCARD_FOR_HAND_LIMIT: "弃牌",
  PLAY_TRANSFER: "转移",
  PASS_REACTION: "跳过反应",
  PASS_LOCK: "不锁定",
  PLAY_LOCK: "锁定",
  PLAY_SWAP: "掉包",
  PLAY_LURE: "调虎离山",
  PLAY_DECRYPT: "破译",
  PLAY_SEPARATION: "离间",
  PLAY_INTERCEPT: "截获",
  PLAY_REINFORCEMENT: "增援",
  PLAY_CONFIDENTIAL_FILE: "机密文件",
  PLAY_BURN: "烧毁",
  PLAY_PROBE: "试探",
  CHOOSE_PROBE_IDENTITY: "选择试探方式",
  CHOOSE_PROBE_DISCARD: "选择弃牌",
  ENTER_TRANSMISSION_PHASE: "进入传情报阶段",
  PLAY_SECRET_ORDER: "秘密下达",
  CLAIM_NO_SECRET_ORDER_MATCH: "没有符合的手牌",
  PLAY_PUBLIC_TEXT: "公开文本",
  PLAY_DANGEROUS_INTELLIGENCE: "危险情报",
  PLAY_FUNCTION_SEPARATION: "离间",
  CHOOSE_DANGEROUS_DISCARD: "选择弃置",
  CHOOSE_PUBLIC_TEXT_EFFECT: "选择效果",
  CHOOSE_PUBLIC_TEXT_DISCARD: "弃置手牌",
  PLAY_COUNTER: "识破",
};

function cardTone(card: PhysicalCard): string {
  return card.color === "红" ? "red" : card.color === "蓝" ? "blue" : card.color === "红蓝" ? "dual" : "black";
}

export function factionBackgroundClass(faction: Faction): string {
  if (faction === "军情") return "game-shell--faction-intelligence";
  if (faction === "潜伏") return "game-shell--faction-undercover";
  return "game-shell--faction-agent";
}

export function seatOrderAnchoredAtPlayer(
  seatOrder: readonly string[],
  playerId: string,
): string[] {
  const anchorIndex = seatOrder.indexOf(playerId);
  if (anchorIndex < 0) throw new Error("当前玩家不在座位顺序中");
  return [...seatOrder.slice(anchorIndex), ...seatOrder.slice(0, anchorIndex)];
}

export function transmissionDirectionForSelection(
  mode: PlayerProjection["mode"],
  circle: boolean,
  direction: "clockwise" | "counterclockwise",
): "clockwise" | "counterclockwise" | undefined {
  return circle && mode !== "duel" ? direction : undefined;
}

export function inspectedHandForProjection(
  projection: PlayerProjection,
): PhysicalCard[] {
  return projection.activeFunctionAction?.inspectedHand ??
    projection.pendingSecretOrder?.inspectedHand ??
    [];
}

export function cardVariantText(card: PhysicalCard): string | undefined {
  const variant = card.variant;
  if (!variant) return undefined;
  if (variant.kind === "probeIdentity") {
    return `军情→${variant.mapping["军情"]} · 潜伏→${variant.mapping["潜伏"]} · 特工→${variant.mapping["特工"]}`;
  }
  if (variant.kind === "probeDrawDiscard") {
    return `${variant.drawFaction}摸 1 张；其他阵营弃 1 张`;
  }
  if (variant.kind === "secretOrder") {
    return `听风→${variant.mapping["听风"]} · 看雨→${variant.mapping["看雨"]} · 日落→${variant.mapping["日落"]}`;
  }
  return undefined;
}

export function publicCardSummary(card: PhysicalCard): string {
  return `${card.name} · ${card.color} · ${card.transmission}`;
}

export function publicTextReceiptEffect(card: PhysicalCard): string | undefined {
  if (card.name !== "公开文本") return undefined;
  if (card.variant?.kind === "publicTextBlack") {
    return `${card.variant.mandatoryDrawFaction}必须摸 1 张；其他阵营选择摸 1 张或摸 2 张`;
  }
  if (card.variant?.kind === "publicTextColor" && card.color === "红") {
    return "潜伏必须弃 1 张；军情／特工选择摸 1 张或弃 1 张";
  }
  if (card.variant?.kind === "publicTextColor" && card.color === "蓝") {
    return "军情必须弃 1 张；潜伏／特工选择摸 1 张或弃 1 张";
  }
  return undefined;
}

function CardDetailDialog({ card, onClose }: { card: PhysicalCard; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | undefined>(undefined);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const stopDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="card-detail-backdrop" onPointerDown={onClose} role="presentation">
      <section
        aria-label={`${card.name}详情`}
        aria-modal="true"
        className="card-detail-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
        style={{ transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }}
      >
        <header
          onDoubleClick={() => setOffset({ x: 0, y: 0 })}
          onPointerCancel={stopDrag}
          onPointerDown={(event) => {
            if (
              event.button !== 0 ||
              !panelRef.current ||
              (event.target as HTMLElement).closest("button")
            ) return;
            const rect = panelRef.current.getBoundingClientRect();
            const margin = 8;
            drag.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: offset.x,
              originY: offset.y,
              minX: offset.x + margin - rect.left,
              maxX: offset.x + window.innerWidth - margin - rect.right,
              minY: offset.y + margin - rect.top,
              maxY: offset.y + window.innerHeight - margin - rect.bottom,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const active = drag.current;
            if (!active || active.pointerId !== event.pointerId) return;
            setOffset({
              x: Math.min(active.maxX, Math.max(active.minX, active.originX + event.clientX - active.startX)),
              y: Math.min(active.maxY, Math.max(active.minY, active.originY + event.clientY - active.startY)),
            });
          }}
          onPointerUp={stopDrag}
          title="拖动调整位置；双击复位"
        >
          <strong>卡牌详情 <i aria-hidden="true">⠿</i></strong>
          <button aria-label="关闭卡牌详情" onClick={onClose} type="button">×</button>
        </header>
        <div className="card-detail-content">
          <CardView card={card} />
          <div>
            <h2>{card.name}</h2>
            <p>{card.color} · {card.transmission}{card.circle ? " · 可选方向" : ""}</p>
            {card.color === "黑" && <p>{card.unburnable ? "不可烧毁" : "可烧毁"}</p>}
            {publicTextReceiptEffect(card) && (
              <section className="receipt-effect-detail">
                <strong>作为情报收到后</strong>
                <p>{publicTextReceiptEffect(card)}</p>
                <small>先检查死亡；存活时再结算此效果。</small>
              </section>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function probeVariantLabel(card: PhysicalCard | undefined): string | undefined {
  if (card?.variant?.kind === "probeIdentity") return "身份代码";
  if (card?.variant?.kind === "probeDrawDiscard") {
    return `${card.variant.drawFaction}摸牌／其他阵营弃牌`;
  }
  return undefined;
}

function CardView({ card, selected, playable, inspectable, onClick }: {
  card: PhysicalCard;
  selected?: boolean;
  playable?: boolean;
  inspectable?: boolean;
  onClick?: () => void;
}) {
  const variantText = cardVariantText(card);
  return (
    <button
      className={`game-card game-card--${cardTone(card)}${selected ? " game-card--selected" : ""}${playable ? " game-card--playable" : ""}${inspectable ? " game-card--inspectable" : ""}`}
      disabled={!onClick}
      onClick={onClick}
      title={`${publicCardSummary(card)}${card.unburnable ? " · 不可烧毁" : ""}`}
      type="button"
    >
      <strong>{card.name}</strong>
      <span>{card.color} · {card.transmission}</span>
      {variantText && <small>{variantText}</small>}
      {card.circle && <small>可选方向</small>}
      {inspectable && <small className="card-detail-hint">查看详情</small>}
      {card.color === "黑" && card.unburnable && (
        <small className="unburnable-badge">不可烧毁</small>
      )}
    </button>
  );
}

function actionCardId(action: ProjectedLegalAction): string | undefined {
  return "cardId" in action ? action.cardId : undefined;
}

function actionTargetId(action: ProjectedLegalAction): string | undefined {
  if ("targetId" in action) return action.targetId;
  if ("targetPlayerId" in action && typeof action.targetPlayerId === "string") {
    return action.targetPlayerId;
  }
  return undefined;
}

export function actionDetail(
  action: ProjectedLegalAction,
  projection: PlayerProjection,
  playerDisplayNames: Readonly<Record<string, string>>,
): string {
  const targetId = actionTargetId(action);
  const target = targetId && projection.players.some((player) => player.id === targetId)
    ? (playerDisplayNames[targetId] ?? targetId)
    : undefined;
  if (action.type === "PLAY_BURN") {
    const targetCard = projection.players
      .find((player) => player.id === action.targetPlayerId)
      ?.intelligence.find((card) => card.id === action.targetIntelligenceCardId);
    return `烧毁 → ${playerDisplayNames[action.targetPlayerId] ?? action.targetPlayerId} 的${targetCard ? `「${targetCard.name}」` : "情报"}`;
  }
  if (action.type === "PLAY_PROBE") {
    const card = projection.own.hand.find((candidate) => candidate.id === action.cardId);
    const variant = probeVariantLabel(card);
    return `试探${variant ? `（${variant}）` : ""}${target ? ` → ${target}` : ""}`;
  }
  if (action.type === "PLAY_SECRET_ORDER") {
    const card = projection.own.hand.find(
      (candidate) => candidate.id === action.cardId,
    );
    const color = card?.variant?.kind === "secretOrder"
      ? card.variant.mapping[action.word]
      : undefined;
    return color ? `秘密下达：${color}` : "秘密下达";
  }
  if (action.type === "CHOOSE_PROBE_IDENTITY") {
    return action.choice === "announce" ? "公开身份代码" : "随机交出一张手牌";
  }
  if (target) return `${ACTION_LABELS[action.type] ?? action.type} → ${target}`;
  if (action.type === "CHOOSE_PUBLIC_TEXT_EFFECT") {
    return action.choice === "drawOne" ? "摸一张牌" : action.choice === "drawTwo" ? "摸两张牌" : "弃置一张手牌";
  }
  return ACTION_LABELS[action.type] ?? action.type;
}

export function promptTitle(projection: PlayerProjection): string {
  const actions = projection.legalActions;
  if (
    projection.phase === "preTransmission" &&
    projection.pendingSecretOrder?.stage === "selection" &&
    projection.activePlayerId === projection.own.id &&
    !projection.reactionWindow
  ) {
    if (actions.some((action) => action.type === "CLAIM_NO_SECRET_ORDER_MATCH")) {
      return `没有符合秘密下达要求的${projection.pendingSecretOrder.requiredColor ?? "指定"}色手牌，请先声明`;
    }
    if (
      projection.pendingSecretOrder.requiredColor &&
      !projection.pendingSecretOrder.verifiedNoMatch
    ) {
      return `秘密下达要求：请选择${projection.pendingSecretOrder.requiredColor}色情报`;
    }
    return "请选择要传递的情报";
  }
  if (actions.length === 0) return "等待其他玩家操作";
  if (actions.some((action) => action.type === "DISCARD_FOR_HAND_LIMIT")) return "手牌超过 7 张，请先弃牌";
  if (actions.some((action) => action.type === "PASS_LOCK")) return "是否锁定这份情报？";
  if (actions.some((action) => action.type === "PASS_REACTION")) return "轮到你响应";
  if (actions.some((action) => action.type === "ACCEPT_INTELLIGENCE")) return "是否接收这份情报？";
  if (actions.some((action) => action.type === "CHOOSE_PUBLIC_TEXT_EFFECT")) return "选择公开文本效果";
  if (actions.some((action) => action.type === "CHOOSE_DANGEROUS_DISCARD")) return "选择要弃置的手牌";
  return projection.activePlayerId === projection.own.id ? "你的行动阶段" : "请选择操作";
}

const REACTION_WINDOW_LABELS: Record<ProjectedReactionKind, string> = {
  intelligence: "情报传递",
  transfer: "转移",
  lock: "锁定",
  swap: "掉包",
  lure: "调虎离山",
  decrypt: "破译",
  burn: "烧毁",
  function: "功能牌",
  secretOrder: "秘密下达",
};

const RECEIPT_STAGE_LABELS: Record<ProjectedReceiptStage, string> = {
  lockOffer: "等待是否锁定",
  reactions: "等待情报响应",
  decision: "等待接收决定",
};

export function reactionWindowLabel(kind: ProjectedReactionKind): string {
  return REACTION_WINDOW_LABELS[kind];
}

export function receiptStageLabel(stage: ProjectedReceiptStage): string {
  return RECEIPT_STAGE_LABELS[stage];
}

export function promptActions(
  actions: readonly ProjectedLegalAction[],
  selectedCardId?: string,
): ProjectedLegalAction[] {
  return actions.filter((action) => {
    const cardId = actionCardId(action);
    if (!cardId || action.type === "PLAY_LOCK") return true;
    return cardId === selectedCardId && !actionTargetId(action);
  });
}

export function mergeAuditLogs(
  gameEntries: readonly string[],
  orderedEvents: readonly PublicAuditEvent[] = [],
): string[] {
  if (orderedEvents.length === 0) return [...gameEntries];
  return [...orderedEvents]
    .sort((left, right) => left.sequence - right.sequence)
    .map((event) => event.text);
}

export function formatAuditEntries(
  entries: readonly string[],
  playerDisplayNames: Readonly<Record<string, string>>,
): string[] {
  return entries.map((entry) =>
    Object.entries(playerDisplayNames).reduce(
      (formatted, [playerId, displayName]) =>
        formatted.split(playerId).join(`【${displayName}】`),
      entry,
    ),
  );
}

export function auditEntryInvolvesPlayer(
  entry: string,
  playerId: string,
  displayName?: string,
): boolean {
  return entry.includes(playerId) || Boolean(displayName && entry.includes(displayName));
}

export function updateIdentityMarkers(
  markers: Readonly<Record<string, Faction>>,
  playerId: string,
  marker: IdentityMarker,
): Record<string, Faction> {
  if (marker) return { ...markers, [playerId]: marker };
  const updated = { ...markers };
  delete updated[playerId];
  return updated;
}

export function privateNoticeText(
  notice: PlayerProjection["privateNotices"][number],
  playerDisplayNames: Readonly<Record<string, string>>,
): string {
  const otherPlayer = playerDisplayNames[notice.otherPlayerId] ?? notice.otherPlayerId;
  if (notice.kind === "secretOrderHandInspected") {
    return `你通过秘密下达查看了【${otherPlayer}】的手牌：`;
  }
  if (notice.kind === "dangerousHandInspected") {
    return `你通过危险情报查看了【${otherPlayer}】的手牌：`;
  }
  if (notice.kind === "publicTextGained") {
    return `你从【${otherPlayer}】手中取得了这张牌：`;
  }
  if (notice.kind === "publicTextLost") {
    return `【${otherPlayer}】通过公开文本从你手中取得了这张牌：`;
  }
  if (notice.kind === "dangerousDiscardLost") {
    return `【${otherPlayer}】通过危险情报从你手中弃置了这张牌：`;
  }
  if (notice.kind === "dangerousDiscardMade") {
    return `你通过危险情报从【${otherPlayer}】手中弃置了这张牌：`;
  }
  if (notice.kind === "probePlayed") {
    return `你对【${otherPlayer}】使用的试探详情：`;
  }
  if (notice.kind === "secretOrderPlayed") {
    return `你对【${otherPlayer}】使用的秘密下达详情：`;
  }
  return `【${otherPlayer}】对你使用的秘密下达详情：`;
}

export function GameTable({
  projection,
  playerDisplayNames = {},
  connected,
  busy = false,
  errorMessage,
  reactionTimer,
  isHost = false,
  reactionTimeoutSeconds,
  autoPassDelayMs,
  publicAuditEvents = [],
  chatMessages = [],
  playerReactions = [],
  spectators = [],
  disconnectedLivingPlayers = [],
  onReactionTimeoutChange,
  onAutoPassDelayChange,
  onMarkDisconnectedPlayerDead,
  onSetBotTakeover,
  onNewGame,
  onSendChat,
  onPlayerReaction,
  onCommand,
}: GameTableProps) {
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [autoPassNoAction, setAutoPassNoAction] = useState(loadAutoPassPreference);
  const [autoPassIgnoreBurn, setAutoPassIgnoreBurn] = useState(loadAutoPassIgnoreBurnPreference);
  const lastAutoPassPrompt = useRef<string | undefined>(undefined);
  const [transmissionMethod, setTransmissionMethod] = useState<"密电" | "文本" | "直达">("直达");
  const [direction, setDirection] = useState<"clockwise" | "counterclockwise">("clockwise");
  const [discardPileOpen, setDiscardPileOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<PhysicalCard>();
  const [privateNoticesCollapsed, setPrivateNoticesCollapsed] = useState(false);
  const [responsePanelOffset, setResponsePanelOffset] = useState({ x: 0, y: 0 });
  const [auditPlayerFilter, setAuditPlayerFilter] = useState("");
  const [identityMarkers, setIdentityMarkers] = useState<Record<string, Faction>>({});
  const [reactionTargetId, setReactionTargetId] = useState<string>();
  const auditLogRef = useRef<HTMLOListElement>(null);
  const auditLogFollowsLatest = useRef(true);
  const chatBubbles = usePlayerChatBubbles(chatMessages);
  const actions = projection.legalActions;
  const playableCardIds = useMemo(() => new Set(actions.map(actionCardId).filter((id): id is string => Boolean(id))), [actions]);
  const selectedActions = selectedCardId ? actions.filter((action) => actionCardId(action) === selectedCardId) : [];
  const visiblePromptActions = promptActions(actions, selectedCardId);
  const inspectedHand = inspectedHandForProjection(projection);
  const selectedBurnActions = selectedCardId
    ? (actions as readonly GameCommand[]).filter(
        (action): action is BurnCommand =>
          action.type === "PLAY_BURN" && action.cardId === selectedCardId,
      )
    : [];
  const selectedCard = projection.own.hand.find((card) => card.id === selectedCardId);
  const forcedChoice = actions.some((action) => action.type === "DISCARD_FOR_HAND_LIMIT");
  const isResolvedPreTransmissionSelection =
    projection.phase === "preTransmission" &&
    projection.pendingSecretOrder?.stage === "selection";
  const canStartTransmission =
    isResolvedPreTransmissionSelection &&
    projection.activePlayerId === projection.own.id &&
    !projection.transmission &&
    !projection.reactionWindow &&
    !forcedChoice;
  const selectableCardIds = new Set(playableCardIds);
  if (canStartTransmission) {
    const requiredColor = projection.pendingSecretOrder?.requiredColor;
    const orderApplies = requiredColor && !projection.pendingSecretOrder?.verifiedNoMatch;
    projection.own.hand
      .filter((card) =>
        !orderApplies ||
        card.color === requiredColor ||
        (card.color === "红蓝" && requiredColor !== "黑"),
      )
      .forEach((card) => selectableCardIds.add(card.id));
  }
  const selectionContext = [
    projection.phase,
    projection.activePlayerId,
    projection.reactionWindow?.kind,
    projection.reactionWindow?.currentResponderId,
    projection.responseStack.at(-1)?.id,
    projection.transmission?.intendedRecipientId,
    projection.transmission?.receiptStage,
    projection.pendingSecretOrder?.stage,
    projection.activeFunctionAction?.stage,
  ].join("|");

  useEffect(() => {
    setSelectedCardId(undefined);
  }, [selectionContext]);

  useEffect(() => {
    if (selectedCardId && !selectableCardIds.has(selectedCardId)) {
      setSelectedCardId(undefined);
    }
  }, [selectedCardId, selectableCardIds]);

  const effectiveMethod = selectedCard?.transmission === "任意" ? transmissionMethod : selectedCard?.transmission;
  const directTransmissionTargetIds = canStartTransmission && selectedCard && effectiveMethod === "直达"
    ? projection.players
        .filter((player) => player.alive && player.id !== projection.own.id)
        .map((player) => player.id)
    : [];
  const targetIds = new Set([
    ...selectedActions
      .filter((action) => action.type !== "PLAY_BURN")
      .map(actionTargetId)
      .filter((id): id is string => Boolean(id)),
    ...directTransmissionTargetIds,
  ]);
  const mergedAuditEntries = mergeAuditLogs(projection.auditLog, publicAuditEvents);
  const auditEntries = mergedAuditEntries
    .map((entry, index) => ({
      index,
      text: formatAuditEntries([entry], playerDisplayNames)[0]!,
    }))
    .filter(({ index }) =>
      !auditPlayerFilter || auditEntryInvolvesPlayer(
        mergedAuditEntries[index]!,
        auditPlayerFilter,
        playerDisplayNames[auditPlayerFilter],
      )
    );

  useEffect(() => {
    const log = auditLogRef.current;
    if (!log || !auditLogFollowsLatest.current) return;
    log.scrollTop = log.scrollHeight;
  }, [auditEntries.length]);
  const displaySeatOrder = useMemo(
    () => seatOrderAnchoredAtPlayer(projection.seatOrder, projection.own.id),
    [projection.own.id, projection.seatOrder],
  );
  const transmissionRecipientIndex = projection.transmission
    ? displaySeatOrder.indexOf(projection.transmission.intendedRecipientId)
    : -1;
  const autoPassAction = automaticPassCommand(actions, autoPassIgnoreBurn);
  const autoPassPrompt = reactionTimer?.promptId ?? (
    projection.reactionWindow
      ? `${projection.reactionWindow.kind}:${projection.reactionWindow.currentResponderId}:${projection.auditLog.length}`
      : projection.transmission?.receiptStage === "lockOffer"
        ? `lock:${projection.transmission.senderId}:${projection.transmission.intendedRecipientId}:${projection.auditLog.length}`
        : undefined
  );

  useEffect(() => {
    if (!autoPassPrompt) {
      lastAutoPassPrompt.current = undefined;
      return;
    }
    if (
      !autoPassNoAction ||
      !connected ||
      busy ||
      !autoPassAction ||
      lastAutoPassPrompt.current === autoPassPrompt
    ) {
      return;
    }
    lastAutoPassPrompt.current = autoPassPrompt;
    const delayMs = automaticPassDelayMs(autoPassAction, projection.own.hand.length, autoPassDelayMs);
    if (delayMs === 0) {
      onCommand(autoPassAction);
      return;
    }
    const timeout = window.setTimeout(() => onCommand(autoPassAction), delayMs);
    return () => window.clearTimeout(timeout);
  }, [autoPassAction, autoPassDelayMs, autoPassNoAction, autoPassPrompt, busy, connected, onCommand, projection.own.hand.length]);

  const chooseTarget = (targetId: string) => {
    const matches = selectedActions.filter((action) => actionTargetId(action) === targetId);
    if (matches.length === 1) {
      onCommand(matches[0]);
      return;
    }
    if (
      matches.length === 0 &&
      selectedCard &&
      effectiveMethod === "直达" &&
      directTransmissionTargetIds.includes(targetId)
    ) {
      onCommand({
        type: "START_TRANSMISSION",
        cardId: selectedCard.id as PhysicalCardId,
        method: effectiveMethod,
        targetId,
      });
    }
  };

  return (
    <main className={`game-shell ${factionBackgroundClass(projection.own.faction)}`}>
      <header className="game-topbar">
        <div><strong>风声</strong><span>{projection.mode === "duel" ? "双人模式" : "标准模式"}</span></div>
        <div className="game-status">
          <span>牌堆 {projection.drawPileCount}</span>
          <DiscardPileButton cards={projection.publicDiscard} onOpen={() => setDiscardPileOpen(true)} />
          <span>旁观：{spectators.filter((spectator) => spectator.connected).map((spectator) => spectator.displayName).join("、") || "无"}</span>
          <span className={connected ? "online-dot" : "offline-dot"}>{connected ? "已连接" : "连接中断，游戏暂停"}</span>
          <label className="auto-pass-control">
            <input
              checked={autoPassNoAction}
              onChange={(event) => {
                const checked = event.target.checked;
                setAutoPassNoAction(checked);
                try {
                  localStorage.setItem(AUTO_PASS_STORAGE_KEY, String(checked));
                } catch {
                  // The preference remains active for this page when storage is unavailable.
                }
              }}
              type="checkbox"
            />
            无可用反应或锁定时自动跳过
          </label>
          <label className="auto-pass-control">
            <input
              checked={autoPassIgnoreBurn}
              disabled={!autoPassNoAction}
              onChange={(event) => {
                const checked = event.target.checked;
                setAutoPassIgnoreBurn(checked);
                try {
                  localStorage.setItem(AUTO_PASS_IGNORE_BURN_STORAGE_KEY, String(checked));
                } catch {
                  // The preference remains active for this page when storage is unavailable.
                }
              }}
              type="checkbox"
            />
            自动跳过时忽略烧毁
          </label>
          {isHost && (
            <label className="table-timeout-control">
              反应时限
              <select
                disabled={busy || !connected}
                onChange={(event) => onReactionTimeoutChange(Number(event.target.value) as ReactionTimeoutSeconds)}
                value={reactionTimeoutSeconds}
              >
                {REACTION_TIMEOUT_OPTIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds === 0 ? "关闭" : `${seconds} 秒`}</option>
                ))}
              </select>
            </label>
          )}
          <label className="table-timeout-control">
            我的自动跳过等待
            <select
              onChange={(event) => onAutoPassDelayChange(Number(event.target.value) as AutoPassDelayMs)}
              value={autoPassDelayMs}
            >
              {AUTO_PASS_DELAY_OPTIONS_MS.map((milliseconds) => (
                <option key={milliseconds} value={milliseconds}>
                  {milliseconds === 0 ? "立即" : `${milliseconds / 1_000} 秒`}
                </option>
              ))}
            </select>
          </label>
          {isHost && disconnectedLivingPlayers.map((player) => (
            <span className="disconnected-player-actions" key={player.id}>
              <button
                className="ai-takeover-button"
                disabled={busy || !connected}
                onClick={() => onSetBotTakeover(player.id, !player.botControlled)}
                type="button"
              >
                {player.botControlled
                  ? `取消机器人接管 ${player.displayName}`
                  : `让机器人接管 ${player.displayName}`}
              </button>
              <button
                className="mark-dead-button"
                disabled={busy || !connected}
                onClick={() => {
                  if (window.confirm(`确定将已断线的 ${player.displayName} 判定为死亡吗？此操作会进行正常死亡结算。`)) {
                    onMarkDisconnectedPlayerDead(player.id);
                  }
                }}
                type="button"
              >
                将 {player.displayName} 判定死亡
              </button>
            </span>
          ))}
        </div>
      </header>

      {errorMessage && <div className="game-error" role="alert">{errorMessage}</div>}
      {projection.winner && (
        <div className="winner-banner">
          <span>游戏结束 · 胜者：{projection.winner.kind === "faction" ? projection.winner.faction : playerDisplayNames[projection.winner.playerId] ?? projection.winner.playerId}</span>
          {isHost
            ? <button disabled={busy || !connected} onClick={onNewGame} type="button">新游戏</button>
            : <small>等待房主开始新游戏</small>}
        </div>
      )}

      <section className="game-layout">
        <div className="table-area">
          <div className="player-ring">
            {displaySeatOrder.map((id, index) => {
              const player = projection.players.find((candidate) => candidate.id === id)!;
              const isOwn = id === projection.own.id;
              const isTarget = targetIds.has(id);
              return (
                <article
                  className={`table-player${isOwn ? " table-player--own" : ""}${player.alive ? "" : " table-player--dead"}${projection.activePlayerId === id ? " table-player--active" : ""}${projection.reactionWindow?.currentResponderId === id ? " table-player--responder" : ""}`}
                  key={id}
                  style={{ "--player-index": index, "--player-count": displaySeatOrder.length } as React.CSSProperties}
                >
                  <PlayerChatBubble message={chatBubbles[id]} />
                  <button
                    aria-expanded={reactionTargetId === id}
                    aria-label={isOwn ? "你的头像" : `与${playerDisplayNames[id] ?? id}互动`}
                    className="player-reaction-trigger"
                    data-reaction-source-player-id={id}
                    disabled={isOwn || busy || !connected}
                    onClick={() => setReactionTargetId((current) =>
                      current === id ? undefined : id
                    )}
                    title={isOwn ? "你的头像" : "点击送花或扔番茄"}
                    type="button"
                  >
                    <span aria-hidden="true">👤</span>
                  </button>
                  {reactionTargetId === id && !isOwn && (
                    <PlayerReactionMenu
                      canChooseGameTarget={isTarget}
                      disabled={busy || !connected}
                      onChooseGameTarget={() => {
                        setReactionTargetId(undefined);
                        chooseTarget(id);
                      }}
                      onClose={() => setReactionTargetId(undefined)}
                      onReact={(kind) => {
                        setReactionTargetId(undefined);
                        onPlayerReaction(kind, id);
                      }}
                      targetName={playerDisplayNames[id] ?? id}
                    />
                  )}
                  <button disabled={!isTarget || busy || !connected} onClick={() => chooseTarget(id)} type="button">
                  <strong data-reaction-target-player-id={id}>
                    {playerDisplayNames[id] ?? id}{isOwn ? "（你）" : ""}
                  </strong>
                    <span>{player.alive ? `${player.handCount} 张手牌` : "已死亡"}</span>
                    {player.faction && <span className="faction-badge">{player.faction}</span>}
                    {isTarget && <em>选择为目标</em>}
                  </button>
                  {!isOwn && !player.faction && (
                    <select
                      aria-label={`标记${playerDisplayNames[id] ?? id}的推测身份`}
                      className={`identity-marker${identityMarkers[id] ? ` identity-marker--${identityMarkers[id] === "军情" ? "intelligence" : identityMarkers[id] === "潜伏" ? "undercover" : "agent"}` : ""}`}
                      onChange={(event) => {
                        const marker = event.target.value as IdentityMarker;
                        setIdentityMarkers((current) => updateIdentityMarkers(current, id, marker));
                      }}
                      title="仅自己可见的推测身份"
                      value={identityMarkers[id] ?? ""}
                    >
                      <option value="">身份？</option>
                      <option value="军情">军情</option>
                      <option value="潜伏">潜伏</option>
                      <option value="特工">特工</option>
                    </select>
                  )}
                  <div
                    className={`intel-row${player.intelligence.length > 4 ? " intel-row--dense" : ""}`}
                    aria-label={`${playerDisplayNames[id] ?? id} 的情报`}
                  >
                    {player.intelligence.map((card) => {
                      const burnAction = selectedBurnActions.find(
                        (action) => action.targetPlayerId === id && action.targetIntelligenceCardId === card.id,
                      );
                      return (
                        <CardView
                          card={card}
                          key={card.id}
                          playable={Boolean(burnAction)}
                          inspectable={card.name === "公开文本" && !burnAction}
                          onClick={burnAction && !busy && connected
                            ? () => onCommand(burnAction)
                            : card.name === "公开文本"
                              ? () => setDetailCard(card)
                              : undefined}
                        />
                      );
                    })}
                    {player.intelligence.length === 0 && <span>暂无情报</span>}
                  </div>
                </article>
              );
            })}

            {projection.transmission && transmissionRecipientIndex >= 0 && (
              <div
                aria-label="待传递情报"
                className="transmission-card-slot"
                style={{
                  "--player-index": transmissionRecipientIndex,
                  "--player-count": displaySeatOrder.length,
                } as React.CSSProperties}
              >
                {projection.transmission.card
                  ? <>
                      <CardView
                        card={projection.transmission.card}
                        inspectable={projection.transmission.card.name === "公开文本"}
                        onClick={projection.transmission.card.name === "公开文本"
                          ? () => setDetailCard(projection.transmission!.card)
                          : undefined}
                      />
                      {publicTextReceiptEffect(projection.transmission.card) && (
                        <small className="transmission-receipt-summary">
                          收到后：{publicTextReceiptEffect(projection.transmission.card)}
                        </small>
                      )}
                    </>
                  : <div className="hidden-card">未公开情报</div>}
              </div>
            )}

            {projection.reactionWindow ? (
              <ResponsePanel
                offset={responsePanelOffset}
                onOffsetChange={setResponsePanelOffset}
                playerDisplayNames={playerDisplayNames}
                projection={projection}
                reactionTimer={reactionTimer}
              />
            ) : (
            <section className={`table-center${projection.transmission ? " table-center--transmission" : ""}`}>
              {projection.transmission ? (
                <>
                  <p>待传递情报 · {projection.transmission.method}</p>
                  <strong>
                    {playerDisplayNames[projection.transmission.senderId] ?? projection.transmission.senderId}
                    {" → "}
                    {playerDisplayNames[projection.transmission.intendedRecipientId] ?? projection.transmission.intendedRecipientId}
                  </strong>
                  <span>{projection.transmission.locked
                    ? "已锁定"
                    : receiptStageLabel(projection.transmission.receiptStage)}</span>
                </>
              ) : (
                <><p>当前回合</p><strong>{playerDisplayNames[projection.activePlayerId] ?? projection.activePlayerId}</strong></>
              )}
            </section>
            )}
          </div>

          <section className="prompt-panel">
            <div>
              <p>
                {projection.reactionWindow
                  ? `响应窗口：${reactionWindowLabel(projection.reactionWindow.kind)}`
                  : "行动提示"}
                {!projection.reactionWindow && reactionTimer && <ReactionCountdown key={reactionTimer.promptId} timer={reactionTimer} />}
              </p>
              <h2>{promptTitle(projection)}</h2>
            </div>
            <div className="prompt-actions">
              {visiblePromptActions.map((action, index) => (
                <button disabled={busy || !connected} key={`${action.type}-${index}`} onClick={() => onCommand(action)} type="button">
                  {actionDetail(action, projection, playerDisplayNames)}
                </button>
              ))}
            </div>
          </section>

          {projection.privateNotices.length > 0 && (
            <section className={`private-notices${privateNoticesCollapsed ? " private-notices--collapsed" : ""}`} aria-label="私人通知">
              <header>
                <h3>私人通知 <small>{projection.privateNotices.length}</small></h3>
                <button
                  aria-expanded={!privateNoticesCollapsed}
                  onClick={() => setPrivateNoticesCollapsed((collapsed) => !collapsed)}
                  type="button"
                >
                  {privateNoticesCollapsed ? "展开" : "收起"}
                </button>
              </header>
              {!privateNoticesCollapsed && projection.privateNotices.map((notice, index) => (
                  <div
                    className="private-notice"
                    key={`${notice.kind}-${notice.otherPlayerId}-${index}`}
                  >
                    <p>{privateNoticeText(notice, playerDisplayNames)}</p>
                    {"cards" in notice ? (
                      <div className="hand-row">
                        {notice.cards.map((card) => <CardView card={card} key={card.id} />)}
                      </div>
                    ) : (
                      <CardView card={notice.card} />
                    )}
                  </div>
                ))}
            </section>
          )}

          {inspectedHand.length > 0 && (
            <section className="inspected-panel">
              <h3>查看到的手牌</h3>
              <div className="hand-row">
                {inspectedHand.map((card) => {
                  const action = actions.find((candidate) => actionCardId(candidate) === card.id);
                  return <CardView card={card} key={card.id} playable={Boolean(action)} onClick={action ? () => onCommand(action) : undefined} />;
                })}
              </div>
            </section>
          )}

          <section className="own-area">
            <div><h2>你的手牌</h2><span>阵营：{projection.own.faction}</span></div>
            <div className="hand-row">
              {projection.own.hand.map((card) => (
                <CardView
                  card={card}
                  key={card.id}
                  playable={selectableCardIds.has(card.id)}
                  selected={selectedCardId === card.id}
                  onClick={selectableCardIds.has(card.id) ? () => setSelectedCardId(card.id === selectedCardId ? undefined : card.id) : undefined}
                />
              ))}
            </div>
            {canStartTransmission && selectedCard && (
              <div className="transmission-composer">
                <strong>{effectiveMethod === "直达" ? "选择接收者" : "发送这张牌"}</strong>
                {selectedCard.transmission === "任意" && (
                  <select onChange={(event) => setTransmissionMethod(event.target.value as typeof transmissionMethod)} value={transmissionMethod}>
                    <option value="直达">直达</option><option value="文本">文本</option><option value="密电">密电</option>
                  </select>
                )}
                {projection.mode !== "duel" && selectedCard.circle && effectiveMethod !== "直达" && (
                  <select onChange={(event) => setDirection(event.target.value as typeof direction)} value={direction}>
                    <option value="clockwise">顺时针</option><option value="counterclockwise">逆时针</option>
                  </select>
                )}
                {effectiveMethod === "直达" ? projection.players.filter((player) => player.alive && player.id !== projection.own.id).map((player) => (
                  <button disabled={busy || !connected} key={player.id} onClick={() => onCommand({ type: "START_TRANSMISSION", cardId: selectedCard.id as PhysicalCardId, method: effectiveMethod, targetId: player.id })} type="button">{playerDisplayNames[player.id] ?? player.id}</button>
                )) : (
                  <button disabled={busy || !connected} onClick={() => onCommand({ type: "START_TRANSMISSION", cardId: selectedCard.id as PhysicalCardId, method: effectiveMethod, direction: transmissionDirectionForSelection(projection.mode, selectedCard.circle, direction) })} type="button">开始传递</button>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="game-sidebar">
          <section className="audit-panel">
            <header>
              <h2>公开记录</h2>
              <label>
                <select
                  aria-label="按玩家筛选公开记录"
                  onChange={(event) => setAuditPlayerFilter(event.target.value)}
                  value={auditPlayerFilter}
                >
                  <option value="">全部玩家</option>
                  {projection.players.map((player) => (
                    <option key={player.id} value={player.id}>
                      {playerDisplayNames[player.id] ?? player.id}{player.id === projection.own.id ? "（你）" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </header>
            <ol
              onScroll={(event) => {
                const log = event.currentTarget;
                auditLogFollowsLatest.current = isNearScrollBottom(
                  log.scrollTop,
                  log.clientHeight,
                  log.scrollHeight,
                );
              }}
              ref={auditLogRef}
            >
              {auditEntries.map((entry) => (
                <li key={`${entry.text}-${entry.index}`} value={entry.index + 1}>{entry.text}</li>
              ))}
            </ol>
          </section>
          <ChatPanel
            busy={busy}
            connected={connected}
            messages={chatMessages}
            onSend={onSendChat}
            playerDisplayNames={playerDisplayNames}
          />
        </aside>
      </section>
      {discardPileOpen && (
        <DiscardPileDialog cards={projection.publicDiscard} onClose={() => setDiscardPileOpen(false)} />
      )}
      {detailCard && <CardDetailDialog card={detailCard} onClose={() => setDetailCard(undefined)} />}
      <PlayerReactionLayer events={playerReactions} playerDisplayNames={playerDisplayNames} />
    </main>
  );
}
