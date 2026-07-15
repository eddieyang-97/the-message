import { useEffect, useMemo, useState } from "react";

import type { PhysicalCard, PhysicalCardId } from "../game/cards";
import type { PlayerProjection } from "../game/engine";
import type { GameCommand, ReactionTimerSnapshot } from "../server";
import { REACTION_TIMEOUT_OPTIONS, type ReactionTimeoutSeconds } from "./lobby-types";
import "./game-table.css";

export type ProjectedLegalAction = PlayerProjection["legalActions"][number];

export interface GameTableProps {
  projection: PlayerProjection;
  connected: boolean;
  busy?: boolean;
  errorMessage?: string;
  reactionTimer?: ReactionTimerSnapshot | null;
  isHost?: boolean;
  reactionTimeoutSeconds: ReactionTimeoutSeconds;
  roomAuditLog?: readonly string[];
  onReactionTimeoutChange: (seconds: ReactionTimeoutSeconds) => void;
  onCommand: (command: GameCommand) => void;
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

function CardView({ card, selected, playable, onClick }: {
  card: PhysicalCard;
  selected?: boolean;
  playable?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`game-card game-card--${cardTone(card)}${selected ? " game-card--selected" : ""}${playable ? " game-card--playable" : ""}`}
      disabled={!onClick}
      onClick={onClick}
      type="button"
    >
      <strong>{card.name}</strong>
      <span>{card.color} · {card.transmission}</span>
      {card.circle && <small>可选方向</small>}
    </button>
  );
}

function actionCardId(action: ProjectedLegalAction): string | undefined {
  return "cardId" in action ? action.cardId : undefined;
}

function actionTargetId(action: ProjectedLegalAction): string | undefined {
  return "targetId" in action ? action.targetId : undefined;
}

function actionDetail(action: ProjectedLegalAction, projection: PlayerProjection): string {
  const targetId = actionTargetId(action);
  const target = targetId ? projection.players.find((player) => player.id === targetId)?.id : undefined;
  if (target) return `${ACTION_LABELS[action.type] ?? action.type} → ${target}`;
  if (action.type === "CHOOSE_PUBLIC_TEXT_EFFECT") {
    return action.choice === "drawOne" ? "摸一张牌" : action.choice === "drawTwo" ? "摸两张牌" : "弃置一张手牌";
  }
  return ACTION_LABELS[action.type] ?? action.type;
}

function promptTitle(projection: PlayerProjection): string {
  const actions = projection.legalActions;
  if (actions.length === 0) return "等待其他玩家操作";
  if (actions.some((action) => action.type === "DISCARD_FOR_HAND_LIMIT")) return "手牌超过 7 张，请先弃牌";
  if (actions.some((action) => action.type === "PASS_LOCK")) return "是否锁定这份情报？";
  if (actions.some((action) => action.type === "PASS_REACTION")) return "轮到你响应";
  if (actions.some((action) => action.type === "ACCEPT_INTELLIGENCE")) return "是否接收这份情报？";
  if (actions.some((action) => action.type === "CHOOSE_PUBLIC_TEXT_EFFECT")) return "选择公开文本效果";
  if (actions.some((action) => action.type === "CHOOSE_DANGEROUS_DISCARD")) return "选择要弃置的手牌";
  return projection.activePlayerId === projection.own.id ? "你的行动阶段" : "请选择操作";
}

function mergeAuditLogs(
  gameEntries: readonly string[],
  roomEntries: readonly string[],
): string[] {
  const merged = [...gameEntries];
  const gameCounts = new Map<string, number>();
  const roomCounts = new Map<string, number>();
  for (const entry of gameEntries) {
    gameCounts.set(entry, (gameCounts.get(entry) ?? 0) + 1);
  }
  for (const entry of roomEntries) {
    const occurrence = (roomCounts.get(entry) ?? 0) + 1;
    roomCounts.set(entry, occurrence);
    if (occurrence > (gameCounts.get(entry) ?? 0)) merged.push(entry);
  }
  return merged;
}

export function GameTable({
  projection,
  connected,
  busy = false,
  errorMessage,
  reactionTimer,
  isHost = false,
  reactionTimeoutSeconds,
  roomAuditLog = [],
  onReactionTimeoutChange,
  onCommand,
}: GameTableProps) {
  const [selectedCardId, setSelectedCardId] = useState<string>();
  const [transmissionMethod, setTransmissionMethod] = useState<"密电" | "文本" | "直达">("直达");
  const [direction, setDirection] = useState<"clockwise" | "counterclockwise">("clockwise");
  const actions = projection.legalActions;
  const playableCardIds = useMemo(() => new Set(actions.map(actionCardId).filter((id): id is string => Boolean(id))), [actions]);
  const selectedActions = selectedCardId ? actions.filter((action) => actionCardId(action) === selectedCardId) : [];
  const targetIds = new Set(selectedActions.map(actionTargetId).filter((id): id is string => Boolean(id)));
  const immediateActions = actions.filter((action) => !actionCardId(action));
  const selectedImmediateActions = selectedActions.filter((action) => !actionTargetId(action));
  const inspectedHand = projection.activeFunctionAction?.inspectedHand ?? [];
  const selectedCard = projection.own.hand.find((card) => card.id === selectedCardId);
  const forcedChoice = actions.some((action) => action.type === "DISCARD_FOR_HAND_LIMIT");
  const canStartTransmission = projection.phase === "initialized" && projection.activePlayerId === projection.own.id && !projection.transmission && !projection.reactionWindow && !forcedChoice;
  const selectableCardIds = new Set(playableCardIds);
  if (canStartTransmission) projection.own.hand.forEach((card) => selectableCardIds.add(card.id));
  const effectiveMethod = selectedCard?.transmission === "任意" ? transmissionMethod : selectedCard?.transmission;
  const auditEntries = mergeAuditLogs(projection.auditLog, roomAuditLog);

  const chooseTarget = (targetId: string) => {
    const matches = selectedActions.filter((action) => actionTargetId(action) === targetId);
    if (matches.length === 1) onCommand(matches[0]);
  };

  return (
    <main className="game-shell">
      <header className="game-topbar">
        <div><strong>风声</strong><span>{projection.mode === "duel" ? "双人模式" : "标准模式"}</span></div>
        <div className="game-status">
          <span>牌堆 {projection.drawPileCount}</span>
          <span>弃牌 {projection.publicDiscard.length}</span>
          <span className={connected ? "online-dot" : "offline-dot"}>{connected ? "已连接" : "连接中断，游戏暂停"}</span>
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
        </div>
      </header>

      {errorMessage && <div className="game-error" role="alert">{errorMessage}</div>}
      {projection.winner && <div className="winner-banner">游戏结束 · 胜者：{projection.winner.kind === "faction" ? projection.winner.faction : projection.winner.playerId}</div>}

      <section className="game-layout">
        <div className="table-area">
          <div className="player-ring">
            {projection.seatOrder.map((id, index) => {
              const player = projection.players.find((candidate) => candidate.id === id)!;
              const isOwn = id === projection.own.id;
              const isTarget = targetIds.has(id);
              return (
                <article
                  className={`table-player${isOwn ? " table-player--own" : ""}${player.alive ? "" : " table-player--dead"}${projection.activePlayerId === id ? " table-player--active" : ""}`}
                  key={id}
                  style={{ "--player-index": index, "--player-count": projection.seatOrder.length } as React.CSSProperties}
                >
                  <button disabled={!isTarget || busy} onClick={() => chooseTarget(id)} type="button">
                    <strong>{id}{isOwn ? "（你）" : ""}</strong>
                    <span>{player.alive ? `${player.handCount} 张手牌` : "已死亡"}</span>
                    {player.faction && <span className="faction-badge">{player.faction}</span>}
                    {isTarget && <em>选择为目标</em>}
                  </button>
                  <div className="intel-row" aria-label={`${id} 的情报`}>
                    {player.intelligence.map((card) => <CardView card={card} key={card.id} />)}
                    {player.intelligence.length === 0 && <span>暂无情报</span>}
                  </div>
                </article>
              );
            })}

            <section className="table-center">
              {projection.transmission ? (
                <>
                  <p>待传递情报 · {projection.transmission.method}</p>
                  {projection.transmission.card
                    ? <CardView card={projection.transmission.card} />
                    : <div className="hidden-card">未公开情报</div>}
                  <strong>{projection.transmission.senderId} → {projection.transmission.intendedRecipientId}</strong>
                  <span>{projection.transmission.locked ? "已锁定" : projection.transmission.receiptStage}</span>
                </>
              ) : (
                <><p>当前回合</p><strong>{projection.activePlayerId}</strong></>
              )}
            </section>
          </div>

          <section className="prompt-panel">
            <div>
              <p>
                {projection.reactionWindow ? `反应窗口：${projection.reactionWindow.kind}` : "行动提示"}
                {reactionTimer && <ReactionCountdown key={reactionTimer.promptId} timer={reactionTimer} />}
              </p>
              <h2>{promptTitle(projection)}</h2>
            </div>
            <div className="prompt-actions">
              {[...immediateActions, ...selectedImmediateActions].map((action, index) => (
                <button disabled={busy || !connected} key={`${action.type}-${index}`} onClick={() => onCommand(action)} type="button">
                  {actionDetail(action, projection)}
                </button>
              ))}
            </div>
          </section>

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
                <strong>发送这张牌</strong>
                {selectedCard.transmission === "任意" && (
                  <select onChange={(event) => setTransmissionMethod(event.target.value as typeof transmissionMethod)} value={transmissionMethod}>
                    <option value="直达">直达</option><option value="文本">文本</option><option value="密电">密电</option>
                  </select>
                )}
                {selectedCard.circle && effectiveMethod !== "直达" && (
                  <select onChange={(event) => setDirection(event.target.value as typeof direction)} value={direction}>
                    <option value="clockwise">顺时针</option><option value="counterclockwise">逆时针</option>
                  </select>
                )}
                {effectiveMethod === "直达" ? projection.players.filter((player) => player.alive && player.id !== projection.own.id).map((player) => (
                  <button disabled={busy || !connected} key={player.id} onClick={() => onCommand({ type: "START_TRANSMISSION", cardId: selectedCard.id as PhysicalCardId, method: effectiveMethod, targetId: player.id })} type="button">发给 {player.id}</button>
                )) : (
                  <button disabled={busy || !connected} onClick={() => onCommand({ type: "START_TRANSMISSION", cardId: selectedCard.id as PhysicalCardId, method: effectiveMethod, direction: selectedCard.circle ? direction : undefined })} type="button">开始传递</button>
                )}
              </div>
            )}
          </section>
        </div>

        <aside className="audit-panel">
          <h2>公开记录</h2>
          <ol>{auditEntries.slice().reverse().map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>
        </aside>
      </section>
    </main>
  );
}
