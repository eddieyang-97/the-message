import type { PhysicalCard } from "../game/cards";
import type { SpectatorProjection } from "../game/engine";
import { formatAuditEntries, mergeAuditLogs } from "./GameTable";
import "./game-table.css";

export interface SpectatorTableProps {
  projection: SpectatorProjection;
  playerDisplayNames: Readonly<Record<string, string>>;
  spectators: readonly { id: string; displayName: string; connected: boolean }[];
  roomAuditLog: readonly string[];
  connected: boolean;
  onLeave: () => void;
}

function cardTone(card: PhysicalCard): string {
  return card.color === "红" ? "red" : card.color === "蓝" ? "blue" : card.color === "红蓝" ? "dual" : "black";
}

function PublicCard({ card }: { card: PhysicalCard }) {
  return (
    <div className={`game-card game-card--${cardTone(card)}`}>
      <strong>{card.name}</strong>
      <span>{card.color} · {card.transmission}</span>
      {card.color === "黑" && card.unburnable && <small className="unburnable-badge">不可烧毁</small>}
    </div>
  );
}

export function SpectatorTable({
  projection,
  playerDisplayNames,
  spectators,
  roomAuditLog,
  connected,
  onLeave,
}: SpectatorTableProps) {
  const auditEntries = formatAuditEntries(
    mergeAuditLogs(projection.auditLog, roomAuditLog),
    playerDisplayNames,
  );
  return (
    <main className="game-shell game-shell--spectator">
      <header className="game-topbar">
        <div><strong>风声</strong><span>旁观模式</span></div>
        <div className="game-status">
          <span>牌堆 {projection.drawPileCount}</span>
          <span>弃牌 {projection.publicDiscard.length}</span>
          <span className={connected ? "online-dot" : "offline-dot"}>{connected ? "已连接" : "连接中断"}</span>
          <span>旁观者：{spectators.filter((item) => item.connected).map((item) => item.displayName).join("、") || "无"}</span>
          <button className="spectator-leave-button" onClick={onLeave} type="button">离开旁观</button>
        </div>
      </header>
      <section className="game-layout">
        <div className="table-area">
          <div className="player-ring">
            {projection.seatOrder.map((id, index) => {
              const player = projection.players.find((candidate) => candidate.id === id)!;
              return (
                <article
                  className={`table-player${player.alive ? "" : " table-player--dead"}${projection.activePlayerId === id ? " table-player--active" : ""}`}
                  key={id}
                  style={{ "--player-index": index, "--player-count": projection.seatOrder.length } as React.CSSProperties}
                >
                  <button disabled type="button">
                    <strong>{playerDisplayNames[id] ?? id}</strong>
                    <span>{player.alive ? `${player.handCount} 张手牌` : "已死亡"}</span>
                    {player.faction && <span className="faction-badge">{player.faction}</span>}
                  </button>
                  <div className={`intel-row${player.intelligence.length > 4 ? " intel-row--dense" : ""}`}>
                    {player.intelligence.map((card) => <PublicCard card={card} key={card.id} />)}
                    {player.intelligence.length === 0 && <span>暂无情报</span>}
                  </div>
                </article>
              );
            })}
            <section className="table-center">
              {projection.transmission ? (
                <>
                  <p>待传递情报 · {projection.transmission.method}</p>
                  <strong>{playerDisplayNames[projection.transmission.senderId] ?? projection.transmission.senderId} → {playerDisplayNames[projection.transmission.intendedRecipientId] ?? projection.transmission.intendedRecipientId}</strong>
                  {projection.transmission.card && <PublicCard card={projection.transmission.card} />}
                </>
              ) : (
                <><p>当前回合</p><strong>{playerDisplayNames[projection.activePlayerId] ?? projection.activePlayerId}</strong></>
              )}
            </section>
          </div>
          <section className="prompt-panel spectator-banner">
            <div><p>旁观模式</p><h2>你可以看到所有公开信息，但不能查看手牌或参与操作</h2></div>
          </section>
        </div>
        <aside className="audit-panel">
          <h2>公开记录</h2>
          <ol>{auditEntries.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>
        </aside>
      </section>
    </main>
  );
}
