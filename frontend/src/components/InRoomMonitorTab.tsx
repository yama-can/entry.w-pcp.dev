import React from "react";
import { SlotTimeline, SeatReservation } from "../types";
import { getLaneTheme } from "../utils/theme";
import { MonitorIcon } from "./Icons";

interface InRoomMonitorTabProps {
  activeDay: number;
  dynamicLanes: string[];
  timeline: SlotTimeline[];
  selectedClosedSlotMap: Record<string, string>;
  setSelectedClosedSlotMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export const InRoomMonitorTab: React.FC<InRoomMonitorTabProps> = ({
  activeDay,
  dynamicLanes,
  timeline,
  selectedClosedSlotMap,
  setSelectedClosedSlotMap,
}) => {
  return (
    <div>
      {/* 室内モニター用ヘッダー説明 */}
      <div
        style={{
          marginBottom: "14px",
          color: "var(--text-secondary)",
          fontSize: "0.88rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <MonitorIcon size={16} color="#38bdf8" />
          <span>室内スタッフ用：各レーンの次回準備対象スロット（案内確定済）</span>
        </div>
        <span className="tabular font-mono" style={{ fontWeight: "700", color: "#fbbf24", fontSize: "0.82rem" }}>
          Day {activeDay} / レーン: {dynamicLanes.join(", ")}
        </span>
      </div>

      {/* レーンごとの分割グリッド */}
      <div className="inroom-split-grid">
        {dynamicLanes.map((laneName) => {
          const theme = getLaneTheme(laneName);
          const closedSlots = timeline.filter((s) => s.lane === laneName && s.is_closed);
          const selectedId = selectedClosedSlotMap[laneName];
          const currentSlot =
            (selectedId ? closedSlots.find((s) => String(s.id) === selectedId) : null) ||
            (closedSlots.length > 0 ? closedSlots[closedSlots.length - 1] : null);

          return (
            <div
              key={laneName}
              className="lane-monitor-column"
              style={{ borderLeft: `4px solid ${theme.color}` }}
            >
              {/* レーンヘッダー */}
              <div className="lane-monitor-header">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span className={theme.badgeClass} style={{ fontSize: "0.85rem", padding: "2px 8px" }}>
                      {laneName}組
                    </span>
                    <h2 style={{ fontSize: "1.1rem", fontWeight: "700", color: "var(--text-main)" }}>
                      {laneName}レーン（{theme.label}）
                    </h2>
                  </div>

                  <div className="tabular" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "4px" }}>
                    {currentSlot ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span>
                          準備対象: <strong style={{ color: "var(--text-main)", fontSize: "0.95rem" }}>{currentSlot.slot_time}</strong>
                        </span>
                        <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
                          (体験{currentSlot.play_duration || 5}分 / 入替{currentSlot.cleanup_duration ?? 2}分)
                        </span>
                        {currentSlot.is_buffer && (
                          <span className="badge-buffer" style={{ fontSize: "0.68rem", padding: "1px 5px" }}>
                            調整枠
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>案内確定待ち（枠割当後に表示）</span>
                    )}
                  </div>
                </div>

                {/* 確定枠切替ドロップダウン */}
                {closedSlots.length > 1 && (
                  <select
                    value={currentSlot?.id || ""}
                    onChange={(e) =>
                      setSelectedClosedSlotMap((prev) => ({
                        ...prev,
                        [laneName]: e.target.value,
                      }))
                    }
                    className="form-input tabular font-mono"
                    style={{
                      width: "auto",
                      padding: "4px 8px",
                      fontSize: "0.78rem",
                      background: "var(--bg-app)",
                    }}
                    title="表示する確定枠を切り替え"
                  >
                    {closedSlots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.slot_time} ({laneName}組)
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 座席ごとの準備一覧 */}
              <div>
                {currentSlot ? (
                  currentSlot.seats.map((seat: SeatReservation) => (
                    <div key={seat.id} className="monitor-seat-row">
                      {/* 座席番号 */}
                      <div className="monitor-seat-no tabular font-mono" style={{ color: theme.color }}>
                        {seat.seat_no}
                      </div>

                      {/* ゲーム情報・整理番号 */}
                      <div className="monitor-game-info">
                        <div className="monitor-game-name">
                          {seat.status === "empty" ? (
                            <span style={{ color: "var(--text-muted)", fontSize: "0.9rem", fontWeight: "normal" }}>
                              空席（予定なし）
                            </span>
                          ) : (
                            <>
                              <span className="tabular font-mono" style={{ color: "#38bdf8", fontWeight: "800" }}>
                                {seat.display_ticket_code || (seat.ticket_number ? `No. ${seat.ticket_number}` : seat.ticket_code)}
                              </span>
                              <span>{seat.game_name || "未指定"}</span>
                            </>
                          )}
                        </div>

                        {seat.game_command && (
                          <div className="monitor-game-cmd">
                            起動: {seat.game_command}
                          </div>
                        )}
                      </div>

                      {/* 準備ステータスバッジ */}
                      <div>
                        {seat.status === "checked_in" ? (
                          <span
                            className="status-pill"
                            style={{
                              background: "var(--success-subtle)",
                              color: "#34d399",
                              border: "1px solid rgba(16, 185, 129, 0.3)",
                              fontSize: "0.74rem",
                              fontWeight: "700",
                            }}
                          >
                            準備OK
                          </span>
                        ) : seat.status === "booked" ? (
                          <span
                            className="status-pill"
                            style={{
                              background: "rgba(245, 158, 11, 0.15)",
                              color: "#fbbf24",
                              fontSize: "0.74rem",
                            }}
                          >
                            未着
                          </span>
                        ) : (
                          <span
                            className="status-pill"
                            style={{
                              background: "var(--bg-surface-hover)",
                              color: "var(--text-muted)",
                              fontSize: "0.74rem",
                            }}
                          >
                            空席
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)" }}>
                    <div style={{ fontWeight: "700", fontSize: "0.95rem", color: theme.color }}>
                      {laneName}組の案内確定待ち
                    </div>
                    <p style={{ fontSize: "0.8rem", marginTop: "6px", maxWidth: "300px", margin: "6px auto 0" }}>
                      「枠割当」で到着客を配席して「枠に割当」を実行すると、確定した入室者・ゲーム名がここに自動表示されます。
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
