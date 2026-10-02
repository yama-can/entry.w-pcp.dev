import React from "react";
import { getTicketDisplayCode } from "../utils/ticketCode";
import { Game, IssuedTicket, WaitStatus } from "../types";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  QrCodeIcon,
  GamepadIcon,
  TicketIcon,
} from "./Icons";

interface KioskTabProps {
  waitStatus: WaitStatus | null;
  activeDay: number;
  scanInput: string;
  setScanInput: (v: string) => void;
  handleScanSubmit: (e: React.FormEvent) => void;
  scanInputRef: React.RefObject<HTMLInputElement | null>;
  games: Game[];
  handleIssueTicket: (gameId: string) => void;
  lastIssued: IssuedTicket | null;
  pendingCheckinTicket: IssuedTicket | null;
  handleImmediateCheckin: () => void;
}

export const KioskTab: React.FC<KioskTabProps> = ({
  waitStatus,
  activeDay,
  scanInput,
  setScanInput,
  handleScanSubmit,
  scanInputRef,
  games,
  handleIssueTicket,
  lastIssued,
  pendingCheckinTicket,
  handleImmediateCheckin,
}) => {
  return (
    <div className="kiosk-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        {/* 待ち時間上限オーバー警告バナー */}
        {waitStatus && !waitStatus.canIssue && waitStatus.reason === "WAIT_LIMIT_EXCEEDED" && (
          <div
            className="card"
            style={{
              borderLeft: "4px solid var(--danger)",
              background: "rgba(239, 68, 68, 0.08)",
              padding: "12px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95rem", fontWeight: "700", color: "#fca5a5" }}>
              <AlertCircleIcon size={18} color="#ef4444" />
              <span>発券一時停止中（待ち時間 約{waitStatus.currentWaitMinutes}分 / 上限{waitStatus.maxWaitMinutes}分）</span>
            </div>
            <div style={{ marginTop: "4px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              再開目安時刻: <strong className="tabular" style={{ color: "#38bdf8" }}>{waitStatus.resumeTime} 頃</strong>
            </div>
          </div>
        )}

        {/* 満席（キャパシティ上限）警告バナー */}
        {waitStatus && !waitStatus.canIssue && waitStatus.reason === "FULL" && (
          <div
            className="card"
            style={{
              borderLeft: "4px solid var(--buffer-color)",
              background: "rgba(168, 85, 247, 0.08)",
              padding: "12px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95rem", fontWeight: "700", color: "#d8b4fe" }}>
              <AlertCircleIcon size={18} color="#c084fc" />
              <span>本日の全枠が満席です（受付終了）</span>
            </div>
          </div>
        )}

        {/* スロット未作成警告バナー */}
        {waitStatus && !waitStatus.canIssue && waitStatus.reason === "NO_SLOTS" && (
          <div
            className="card"
            style={{
              borderLeft: "4px solid var(--warning)",
              background: "rgba(245, 158, 11, 0.08)",
              padding: "12px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95rem", fontWeight: "700", color: "#fde68a" }}>
              <AlertCircleIcon size={18} color="#f59e0b" />
              <span>スロット未作成：「設定」タブからスロットを生成してください</span>
            </div>
          </div>
        )}

        {waitStatus && !waitStatus.canIssue && waitStatus.reason === "PAUSED" && (
          <div
            className="card"
            style={{
              borderLeft: "4px solid var(--danger)",
              background: "rgba(239, 68, 68, 0.08)",
              padding: "12px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.95rem", fontWeight: "700", color: "#fca5a5" }}>
              <AlertCircleIcon size={18} color="#ef4444" />
              <span>発券を一時停止しています</span>
            </div>
            <div style={{ marginTop: "4px", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              受付再開までお待ちください。
            </div>
          </div>
        )}

        {/* スキャン入力カード */}
        <div className="card" style={{ padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <QrCodeIcon size={18} color="#38bdf8" />
              <h2 style={{ fontSize: "0.95rem", fontWeight: "700" }}>受付 バーコードスキャン</h2>
            </div>
            {waitStatus && (
              <span
                className="status-pill"
                style={{
                  background: waitStatus.canIssue ? "var(--success-subtle)" : "var(--danger-subtle)",
                  color: waitStatus.canIssue ? "#34d399" : "#f87171",
                  fontSize: "0.74rem",
                }}
              >
                待ち時間: 約{waitStatus.currentWaitMinutes}分
              </span>
            )}
          </div>

          <form onSubmit={handleScanSubmit}>
            <input
              ref={scanInputRef}
              type="text"
              className="form-input tabular font-mono"
              style={{
                fontSize: "1.1rem",
                padding: "10px 14px",
                borderColor: "var(--border-strong)",
              }}
              disabled={waitStatus ? !waitStatus.canIssue : false}
              placeholder={
                waitStatus && !waitStatus.canIssue
                  ? waitStatus.reason === "WAIT_LIMIT_EXCEEDED"
                    ? `発券一時停止中 (再開目安: ${waitStatus.resumeTime}頃)`
                    : waitStatus.reason === "FULL"
                    ? "全枠満席のため発券停止中"
                    : waitStatus.reason === "PAUSED"
                    ? "管理者による発券一時停止中"
                    : "スロット未生成のため発券不可"
                  : "バーコード入力待機中 (Enter)"
              }
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onBlur={() => {
                setTimeout(() => scanInputRef.current?.focus(), 150);
              }}
              autoFocus
            />
          </form>
        </div>

        {/* 手動クイック発券ボタン一覧 */}
        <div className="card" style={{ padding: "14px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <GamepadIcon size={16} color="#38bdf8" />
              <h3 style={{ fontSize: "0.9rem", fontWeight: "700" }}>体験ゲーム一覧</h3>
            </div>
            {waitStatus && !waitStatus.canIssue && (
              <span style={{ fontSize: "0.75rem", color: "var(--danger)" }}>
                発券停止中
              </span>
            )}
          </div>

          <div className="quick-game-grid">
            {games.map((game) => {
              const disabled = waitStatus ? !waitStatus.canIssue : false;
              return (
                <button
                  key={game.id}
                  className="quick-game-btn"
                  disabled={disabled}
                  style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
                  onClick={() => handleIssueTicket(game.id)}
                  title={disabled ? waitStatus?.message : `${game.name}を発券`}
                >
                  <span className="tabular font-mono" style={{ fontSize: "0.72rem", color: "#38bdf8", fontWeight: "700" }}>
                    {game.id}
                  </span>
                  <span style={{ fontSize: "0.9rem", fontWeight: "600", color: "var(--text-main)" }}>
                    {game.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 直前発券チケットカード */}
      <div>
        {lastIssued ? (
          <div
            className="card"
            style={{
              borderLeft: "4px solid var(--primary)",
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div
              style={{
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                background: "var(--bg-app)",
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              案内札をお渡しください
            </div>

            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div
                className="tabular font-mono"
                style={{
                  fontSize: "3.6rem",
                  fontWeight: "900",
                  color: "#38bdf8",
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {lastIssued.display_ticket_code || getTicketDisplayCode(lastIssued.ticket_number, lastIssued.priority_level)}
              </div>
            </div>

            <div
              style={{
                background: "var(--bg-card-muted)",
                padding: "14px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ fontSize: "1.2rem", fontWeight: "700", color: "var(--text-main)" }}>
                {lastIssued.game_name}
              </div>
              <div className="tabular" style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "4px" }}>
                Day {activeDay} / 案内待機人数: {lastIssued.waiting_count || 1}名
              </div>

              {pendingCheckinTicket?.id === lastIssued.id && lastIssued.status !== "checked_in" && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "14px",
                    borderRadius: "var(--radius-md)",
                    border: "2px solid #fbbf24",
                    background: "rgba(245, 158, 11, 0.12)",
                  }}
                >
                  <div style={{ fontWeight: 800, color: "#fde68a", marginBottom: "6px" }}>
                    集合時間を確認してください
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleImmediateCheckin}
                    style={{ width: "100%", padding: "12px", fontWeight: 800 }}
                  >
                    今すぐチェックイン
                  </button>
                </div>
              )}

              {lastIssued.status === "checked_in" && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "10px 14px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--success)",
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "#86efac",
                    fontWeight: 700,
                    fontSize: "0.95rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <CheckCircleIcon size={18} color="#86efac" />
                  <span>チェックイン完了（到着済み）</span>
                </div>
              )}

              {lastIssued.expected_slot_time && (
                <div
                  style={{
                    marginTop: "10px",
                    background: "rgba(14, 165, 233, 0.16)",
                    border: "2px solid #38bdf8",
                    borderRadius: "var(--radius-sm)",
                    padding: "14px 16px",
                    boxShadow: "0 0 0 3px rgba(56, 189, 248, 0.12)",
                  }}
                >
                  <div style={{ fontSize: "0.8rem", fontWeight: "800", color: "#bae6fd", letterSpacing: "0.08em" }}>
                    次に来る時間（大切）
                  </div>
                  <div className="tabular" style={{ fontSize: "1.55rem", fontWeight: "900", color: "#f0f9ff", marginTop: "3px" }}>
                    集合時間：{lastIssued.meeting_time || "計算中"}
                  </div>
                  <div className="tabular" style={{ fontSize: "1rem", fontWeight: "700", color: "#7dd3fc", marginTop: "3px" }}>
                    体験開始予定：{lastIssued.expected_slot_time} {lastIssued.expected_lane ? `(${lastIssued.expected_lane}組)` : ""}
                  </div>
                  {lastIssued.original_expected_slot_time &&
                    lastIssued.original_expected_slot_time !== lastIssued.expected_slot_time && (
                      <div style={{ fontSize: "0.75rem", color: "#fbbf24", marginTop: "2px" }}>
                        本来の定刻: {lastIssued.original_expected_slot_time}
                      </div>
                    )}
                  <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                    集合時間は体験開始の7分前です。時間までに集合場所へお越しください。
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="card"
            style={{
              height: "100%",
              minHeight: "280px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              border: "1px dashed var(--border-medium)",
              textAlign: "center",
              padding: "24px",
            }}
          >
            <TicketIcon size={40} color="var(--border-strong)" style={{ marginBottom: "12px" }} />
            <h3 style={{ fontSize: "1.05rem", fontWeight: "600", color: "var(--text-secondary)" }}>
              発券待機中 【Day {activeDay}】
            </h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", marginTop: "6px", maxWidth: "280px" }}>
              ゲームを選択すると整理券が発行され、番号が表示されます。
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
