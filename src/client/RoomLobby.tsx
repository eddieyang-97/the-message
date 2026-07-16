import { useId, type CSSProperties } from "react";

import {
  REACTION_TIMEOUT_OPTIONS,
  type LobbyPlayer,
  type PlayerCount,
  type ReactionTimeoutSeconds,
  type SeatSwapRequest,
  type StartMode,
} from "./lobby-types";
import "./lobby.css";

export interface RoomLobbyProps {
  roomCode: string;
  inviteUrl: string;
  capacity: PlayerCount;
  players: readonly LobbyPlayer[];
  spectators?: readonly { id: string; displayName: string; connected: boolean }[];
  isSpectator?: boolean;
  selfPlayerId: string;
  swapRequests?: readonly SeatSwapRequest[];
  reactionTimeoutSeconds: ReactionTimeoutSeconds;
  startDisabledReason?: string;
  busyAction?: string;
  notice?: string;
  errorMessage?: string;
  onCopyInvite: (inviteUrl: string) => void;
  onMoveSeat: (seat: number) => void;
  onRespondToSwap: (requestId: string, accept: boolean) => void;
  onRemovePlayer: (playerId: string) => void;
  onAddBot: (seat: number) => void;
  onFillEmptySeatsWithBots: () => void;
  onRemoveBot: (playerId: string) => void;
  onLeaveRoom: () => void;
  onReactionTimeoutChange: (seconds: ReactionTimeoutSeconds) => void;
  onStartGame: (mode: StartMode) => void;
}
function timeoutLabel(seconds: ReactionTimeoutSeconds): string {
  return seconds === 0 ? "关闭" : `${seconds} 秒`;
}

function SeatCard({
  seat,
  player,
  selfPlayerId,
  isHost,
  disabled,
  onMoveSeat,
  onRemovePlayer,
  onAddBot,
  onRemoveBot,
}: {
  seat: number;
  player?: LobbyPlayer;
  selfPlayerId: string;
  isHost: boolean;
  disabled: boolean;
  onMoveSeat: (seat: number) => void;
  onRemovePlayer: (playerId: string) => void;
  onAddBot: (seat: number) => void;
  onRemoveBot: (playerId: string) => void;
}) {
  const isSelf = player?.id === selfPlayerId;
  const seatAction = player
    ? isSelf
      ? "当前座位"
      : `请求与 ${player.displayName} 换位`
    : `移动到 ${seat} 号座位`;

  return (
    <article
      className={`seat-card${isSelf ? " seat-card--self" : ""}${player ? "" : " seat-card--empty"}`}
      style={{ "--seat-index": seat - 1 } as CSSProperties}
    >
      <div className="seat-number" aria-hidden="true">{seat}</div>
      {player ? (
        <>
          <div className="seat-player">
            <strong>{player.displayName}</strong>
            <div className="badges">
              {player.isHost && <span className="badge badge--host">房主</span>}
              {player.isBot ? (
                <span className="badge badge--bot">AI</span>
              ) : (
                <span className={`badge ${player.isConnected ? "badge--online" : "badge--offline"}`}>
                  {player.isConnected ? "在线" : "已断线"}
                </span>
              )}
              {isSelf && <span className="badge">你</span>}
            </div>
          </div>
          {!isSelf && !player.isBot && (
            <button
              className="button button--small button--text"
              disabled={disabled}
              onClick={() => onMoveSeat(seat)}
              type="button"
            >
              {seatAction}
            </button>
          )}
          {isHost && player.isBot && (
            <button
              className="button button--small button--danger"
              disabled={disabled}
              onClick={() => onRemoveBot(player.id)}
              type="button"
            >
              移除 AI
            </button>
          )}
          {isHost && !player.isHost && !player.isBot && (
            <button
              className="button button--small button--danger"
              disabled={disabled}
              onClick={() => onRemovePlayer(player.id)}
              type="button"
            >
              移出房间
            </button>
          )}
        </>
      ) : (
        <>
          <span className="empty-seat-label">空座位</span>
          <button
            aria-label={seatAction}
            className="button button--small button--text"
            disabled={disabled}
            onClick={() => onMoveSeat(seat)}
            type="button"
          >
            移到这里
          </button>
          {isHost && (
            <button
              aria-label={`在 ${seat} 号座位添加 AI`}
              className="button button--small button--secondary"
              disabled={disabled}
              onClick={() => onAddBot(seat)}
              type="button"
            >
              添加 AI
            </button>
          )}
        </>
      )}
    </article>
  );
}

export function RoomLobby({
  roomCode,
  inviteUrl,
  capacity,
  players,
  spectators = [],
  isSpectator = false,
  selfPlayerId,
  swapRequests = [],
  reactionTimeoutSeconds,
  startDisabledReason,
  busyAction,
  notice,
  errorMessage,
  onCopyInvite,
  onMoveSeat,
  onRespondToSwap,
  onRemovePlayer,
  onAddBot,
  onFillEmptySeatsWithBots,
  onRemoveBot,
  onLeaveRoom,
  onReactionTimeoutChange,
  onStartGame,
}: RoomLobbyProps) {
  const timeoutId = useId();
  const self = players.find((player) => player.id === selfPlayerId);
  const isHost = self?.isHost ?? false;
  const playerBySeat = new Map(players.map((player) => [player.seat, player]));
  const seats = Array.from({ length: capacity }, (_, index) => index + 1);
  const isBusy = busyAction !== undefined;
  const cannotStart = Boolean(startDisabledReason) || isBusy;

  return (
    <main className="lobby-shell">
      <header className="room-header panel">
        <div>
          <p className="eyebrow">等候室 · {players.length}/{capacity} 人 · {spectators.length} 名旁观者</p>
          <h1 className="room-code" aria-label={`房间码 ${roomCode}`}>
            {roomCode.toUpperCase()}
          </h1>
        </div>
        <div className="header-actions">
          <button
            className="button button--secondary"
            onClick={() => onCopyInvite(inviteUrl)}
            type="button"
          >
            复制邀请链接
          </button>
          <button
            className="button button--text"
            disabled={isBusy}
            onClick={onLeaveRoom}
            type="button"
          >
            离开房间
          </button>
        </div>
      </header>

      {(notice || errorMessage) && (
        <div className={`status-banner ${errorMessage ? "status-banner--error" : ""}`} role="status">
          {errorMessage ?? notice}
        </div>
      )}

      {spectators.length > 0 && (
        <section className="panel spectator-list">
          <strong>旁观者</strong>
          <span>{spectators.map((spectator) => `${spectator.displayName}${spectator.connected ? "" : "（离线）"}`).join("、")}</span>
        </section>
      )}

      {swapRequests.length > 0 && (
        <section className="panel swap-panel" aria-labelledby="swap-heading">
          <h2 id="swap-heading">换位请求</h2>
          {swapRequests.map((request) => (
            <div className="swap-request" key={request.id}>
              <p>
                <strong>{request.fromDisplayName}</strong> 想与你交换
                {request.fromSeat} 号和 {request.toSeat} 号座位。
              </p>
              <div className="inline-actions">
                <button
                  className="button button--primary button--small"
                  disabled={isBusy}
                  onClick={() => onRespondToSwap(request.id, true)}
                  type="button"
                >
                  同意
                </button>
                <button
                  className="button button--text button--small"
                  disabled={isBusy}
                  onClick={() => onRespondToSwap(request.id, false)}
                  type="button"
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="seat-section" aria-labelledby="seats-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">顺时针座次</p>
            <h2 id="seats-heading">选择座位</h2>
          </div>
          <p className="muted">{isSpectator ? "旁观者不占用座位。" : "点击空位直接移动；点击其他玩家发送换位请求。"}</p>
        </div>
        <div
          className="seat-ring"
          style={{ "--seat-count": capacity } as CSSProperties}
        >
          {seats.map((seat) => (
            <SeatCard
              disabled={isBusy || isSpectator}
              isHost={isHost}
              key={seat}
              onMoveSeat={onMoveSeat}
              onRemovePlayer={onRemovePlayer}
              onAddBot={onAddBot}
              onRemoveBot={onRemoveBot}
              player={playerBySeat.get(seat)}
              seat={seat}
              selfPlayerId={selfPlayerId}
            />
          ))}
          <div className="seat-ring-center" aria-hidden="true">
            <span>顺时针</span>
            <span className="clockwise-arrow">↻</span>
          </div>
        </div>
      </section>

      {isHost ? (
        <section className="host-grid">
          <div className="panel host-panel">
            <p className="eyebrow">房主设置</p>
            <h2>反应时限</h2>
            <label htmlFor={timeoutId}>可选反应自动跳过</label>
            <select
              disabled={isBusy}
              id={timeoutId}
              onChange={(event) =>
                onReactionTimeoutChange(Number(event.target.value) as ReactionTimeoutSeconds)
              }
              value={reactionTimeoutSeconds}
            >
              {REACTION_TIMEOUT_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>{timeoutLabel(seconds)}</option>
              ))}
            </select>
            <p className="help-text">必选操作不会自动处理。游戏中修改会从下一次反应开始生效。</p>
          </div>

          <div className="panel host-panel start-panel">
            <p className="eyebrow">房主操作</p>
            <h2>开始游戏</h2>
            {players.length < capacity && (
              <button
                className="button button--secondary button--wide"
                disabled={isBusy}
                onClick={onFillEmptySeatsWithBots}
                type="button"
              >
                用 AI 填满空位
              </button>
            )}
            {startDisabledReason && (
              <p className="start-reason" role="status">{startDisabledReason}</p>
            )}
            <button
              className="button button--primary button--wide"
              disabled={cannotStart}
              onClick={() => onStartGame("current-seats")}
              type="button"
            >
              按当前座位开始
            </button>
            <button
              className="button button--secondary button--wide"
              disabled={cannotStart}
              onClick={() => onStartGame("random-seats")}
              type="button"
            >
              随机座位开始
            </button>
          </div>
        </section>
      ) : (
        <section className="panel waiting-panel">
          <p className="eyebrow">等待开始</p>
          <h2>{startDisabledReason ?? "房间已满，等待房主开始游戏。"}</h2>
        </section>
      )}
    </main>
  );
}
