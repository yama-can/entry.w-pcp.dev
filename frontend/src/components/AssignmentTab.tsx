import React, { useState } from "react";
import { AssignmentSlotStatus, SeatReservation, PlannedSeat, BufferSummary } from "../types";
import { RefreshCwIcon, UserXIcon } from "./Icons";
import { getLaneTheme } from "../utils/theme";
import { ReassignSource } from "./ReassignModal";

interface AssignmentTabProps {
  unassignedCheckedInCount: number;
  fetchData: () => void;
  assignmentSlots: AssignmentSlotStatus[];
  handleFillSlot: (slotId: number, slotTime: string, lane: string) => void;
  handleUnfillSlot: (slotId: number, slotTime: string, lane: string) => void;
  setReassignModalSource: (src: ReassignSource | null) => void;
  handleCancelReservation: (reservationId: number, e: React.MouseEvent) => void;
  bufferSummary?: BufferSummary | null;
  handleToggleMaintenance?: (slotId: number) => void;
}

export const AssignmentTab: React.FC<AssignmentTabProps> = ({
  unassignedCheckedInCount,
  fetchData,
  assignmentSlots,
  handleFillSlot,
  handleUnfillSlot,
  setReassignModalSource,
  handleCancelReservation,
  bufferSummary,
  handleToggleMaintenance,
}) => {
  // モバイル用表示タブ切り替え ('unassigned' | 'assigned' | 'all')
  const [mobileFilter, setMobileFilter] = useState<"unassigned" | "assigned" | "all">("unassigned");

  // ① 未案内スロット（is_closed === false）: 時系列昇順（早い時刻が上）
  const unassignedSlots = assignmentSlots
    .filter((s) => !s.is_closed)
    .sort((a, b) => {
      const [aH, aM] = a.slot_time.split(":").map(Number);
      const [bH, bM] = b.slot_time.split(":").map(Number);
      const aTotal = aH * 60 + aM;
      const bTotal = bH * 60 + bM;
      if (aTotal !== bTotal) return aTotal - bTotal;
      return a.order_idx - b.order_idx;
    });

  // ② 案内済みスロット（is_closed === true）: 最上部が最も遅い時刻（降順）
  const assignedSlots = assignmentSlots
    .filter((s) => s.is_closed)
    .sort((a, b) => {
      const [aH, aM] = a.slot_time.split(":").map(Number);
      const [bH, bM] = b.slot_time.split(":").map(Number);
      const aTotal = aH * 60 + aM;
      const bTotal = bH * 60 + bM;
      if (bTotal !== aTotal) return bTotal - aTotal; // 降順
      return b.order_idx - a.order_idx;
    });

  // スロットカード単体の描画関数
  const renderSlotCard = (slot: AssignmentSlotStatus) => {
    const theme = getLaneTheme(slot.lane);
    const assignedCount = slot.seats.filter((s: SeatReservation) => s.is_assigned).length;
    const plannedCount = slot.plannedSeats?.length || 0;

    return (
      <div
        key={slot.id}
        className="entrance-slot-card"
        style={{
          borderLeftColor: slot.is_maintenance ? "#eab308" : slot.is_buffer ? "var(--buffer-color)" : theme.color,
          background: slot.is_closed ? "rgba(17, 24, 39, 0.5)" : slot.is_maintenance ? "rgba(234, 179, 8, 0.04)" : "var(--bg-card)",
          opacity: slot.is_closed ? 0.8 : 1,
        }}
      >
        {/* 枠ヘッダー */}
        <div className="slot-header">
          <div className="slot-time-large">
            <span className="tabular font-mono" style={{ fontSize: "1.25rem", fontWeight: "700", color: "var(--text-main)" }}>
              {slot.slot_time}
            </span>
            <span
              className={theme.badgeClass}
              style={{ fontSize: "0.75rem", padding: "2px 6px" }}
            >
              {slot.lane}組
            </span>
            {slot.is_maintenance ? (
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(234, 179, 8, 0.2)",
                  color: "#facc15",
                  border: "1px solid rgba(234, 179, 8, 0.4)",
                  fontWeight: 700,
                }}
              >
                メンテナンス枠（割当停止）
              </span>
            ) : slot.is_buffer ? (
              <span className="badge-buffer" style={{ fontSize: "0.75rem", padding: "2px 6px" }}>
                調整枠
              </span>
            ) : slot.meeting_time ? (
              <span
                style={{
                  fontSize: "0.72rem",
                  padding: "2px 6px",
                  borderRadius: "var(--radius-sm)",
                  background: slot.is_meeting_reached ? "var(--success-subtle)" : "rgba(245, 158, 11, 0.1)",
                  color: slot.is_meeting_reached ? "#34d399" : "#fbbf24",
                  border: `1px solid ${slot.is_meeting_reached ? "rgba(16, 185, 129, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                }}
              >
                集合 {slot.meeting_time}〜 {slot.is_meeting_reached ? "集合中" : "待機"}
              </span>
            ) : null}
          </div>

          {/* アクションボタン */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {!slot.is_closed ? (
              slot.is_maintenance ? (
                <div style={{ display: "flex", gap: "6px" }}>
                  {handleToggleMaintenance && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleToggleMaintenance(slot.id)}
                      style={{ padding: "6px 10px", fontSize: "0.8rem", color: "#facc15", borderColor: "rgba(234, 179, 8, 0.4)" }}
                      title="メンテナンス枠を解除して通常枠に戻します"
                    >
                      メンテ解除
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (confirm(`【${slot.lane}組 ${slot.slot_time}】はメンテナンス枠です。スキップ（空枠完了）しますか？`)) {
                        handleFillSlot(slot.id, slot.slot_time, slot.lane);
                      }
                    }}
                    style={{ padding: "6px 10px", fontSize: "0.8rem", color: "var(--text-muted)" }}
                    title="メンテナンス完了として枠を終了します"
                  >
                    メンテ完了
                  </button>
                </div>
              ) : plannedCount > 0 ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => handleFillSlot(slot.id, slot.slot_time, slot.lane)}
                  style={{
                    background: "var(--success)",
                    padding: "6px 14px",
                    fontWeight: "700",
                    fontSize: "0.85rem",
                  }}
                  title="割当予定を確定します"
                >
                  枠に割当 ({plannedCount}名)
                </button>
              ) : slot.is_buffer ? (
                <div style={{ display: "flex", gap: "6px" }}>
                  {handleToggleMaintenance && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleToggleMaintenance(slot.id)}
                      style={{ padding: "6px 8px", fontSize: "0.75rem", color: "var(--text-muted)" }}
                      title="メンテナンス枠（割当停止）に切り替えます"
                    >
                      メンテ化
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (confirm(`【${slot.lane}組 ${slot.slot_time}】は調整枠です。スキップ（空枠として完了）しますか？`)) {
                        handleFillSlot(slot.id, slot.slot_time, slot.lane);
                      }
                    }}
                    style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                    title="調整枠をスキップして完了します"
                  >
                    調整枠スキップ
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "6px" }}>
                  {handleToggleMaintenance && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => handleToggleMaintenance(slot.id)}
                      style={{ padding: "6px 8px", fontSize: "0.75rem", color: "var(--text-muted)" }}
                      title="メンテナンス枠（割当停止）に切り替えます"
                    >
                      メンテ化
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      if (confirm(`【${slot.lane}組 ${slot.slot_time}】は空き枠です。スキップして完了しますか？`)) {
                        handleFillSlot(slot.id, slot.slot_time, slot.lane);
                      }
                    }}
                    style={{ padding: "6px 10px", fontSize: "0.8rem", color: "var(--text-muted)" }}
                    title="空枠として確定します"
                  >
                    枠スキップ
                  </button>
                </div>
              )
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    color: "var(--text-secondary)",
                    fontWeight: "600",
                    fontSize: "0.8rem",
                  }}
                >
                  案内済 ({assignedCount}名)
                </span>
                <button
                  type="button"
                  onClick={() => handleUnfillSlot(slot.id, slot.slot_time, slot.lane)}
                  style={{
                    background: "transparent",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle)",
                    padding: "3px 8px",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.74rem",
                    cursor: "pointer",
                  }}
                  title="割当を解除して未案内に戻す"
                >
                  解除
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 座席カード一覧 */}
        <div className="assignment-seat-grid">
          {slot.seats.map((seat: SeatReservation) => {
            const planned = slot.plannedSeats?.find((p: PlannedSeat) => p.seatNo === seat.seat_no);
            const isAssigned = seat.is_assigned;

            // 1. 確定済みの席
            if (isAssigned) {
              return (
                <div
                  key={seat.id}
                  className="seat-card checked_in"
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="seat-no-badge">{seat.seat_no}席</span>
                    <span
                      className="seat-status-label"
                      style={{ background: "rgba(16, 185, 129, 0.15)", color: "#34d399" }}
                    >
                      確定
                    </span>
                  </div>

                  <div className="seat-game-title">
                    {seat.game_name || "未指定"}
                  </div>

                  <div
                    className="tabular font-mono"
                    style={{ fontSize: "0.82rem", color: "var(--text-main)", fontWeight: "600" }}
                  >
                    {seat.display_ticket_code || seat.ticket_code}
                  </div>

                  <div style={{ display: "flex", gap: "4px", marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() =>
                        setReassignModalSource({
                          reservationId: seat.id,
                          ticketCode: seat.assigned_ticket_code || seat.ticket_code,
                          slotTime: slot.slot_time,
                          lane: slot.lane,
                          gameName: seat.game_name || "ゲーム未指定",
                        })
                      }
                      style={{
                        fontSize: "0.68rem",
                        background: "var(--bg-surface-hover)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        padding: "2px 6px",
                        cursor: "pointer",
                      }}
                      title="別席へ振替"
                    >
                      移動
                    </button>
                    <button
                      className="seat-cancel-btn"
                      onClick={(e) => handleCancelReservation(seat.id, e)}
                      title="欠席処理（空席に戻す）"
                    >
                      <UserXIcon size={12} />
                    </button>
                  </div>
                </div>
              );
            }

            // 2. 割当予定の席（プレビュー）
            if (planned) {
              const isDelayed = planned.assignmentType === "delayed";
              const isAdvanced = planned.assignmentType === "advanced";
              const isBuffer = planned.assignmentType === "buffer";

              let borderColor = "var(--primary)";
              let labelText = "割当予定";
              let labelColor = "#38bdf8";

              if (isDelayed) {
                borderColor = "var(--warning)";
                labelText = slot.is_buffer ? "調整枠（遅刻者）" : "遅延（到着順）";
                labelColor = "#fbbf24";
              } else if (isAdvanced) {
                borderColor = slot.is_buffer ? "var(--buffer-color)" : "var(--info)";
                labelText = "前倒し";
                labelColor = slot.is_buffer ? "#c084fc" : "#22d3ee";
              } else if (isBuffer) {
                borderColor = "var(--buffer-color)";
                labelText = "調整枠";
                labelColor = "#c084fc";
              }

              return (
                <div
                  key={seat.id}
                  className="seat-card"
                  style={{
                    border: `1px dashed ${borderColor}`,
                    background: "rgba(15, 23, 42, 0.4)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="seat-no-badge">{seat.seat_no}席</span>
                    {planned.priorityLevel === 2 && <span className="seat-status-label" style={{ color: "#f87171" }}>即時</span>}
                    {planned.priorityLevel === 1 && <span className="seat-status-label" style={{ color: "#fbbf24" }}>優先</span>}
                    <span
                      className="seat-status-label"
                      style={{ color: labelColor, background: "rgba(255, 255, 255, 0.05)" }}
                    >
                      {labelText}
                    </span>
                  </div>

                  <div className="seat-game-title">
                    {planned.gameName || "未指定"}
                  </div>

                  <div
                    className="tabular font-mono"
                    style={{ fontSize: "0.85rem", color: labelColor, fontWeight: "700" }}
                  >
                    {planned.displayTicketCode ||
                      (planned.ticketNumber
                        ? (planned.priorityLevel === 2 ? `I${String(planned.ticketNumber).padStart(3, "0")}` : planned.priorityLevel === 1 ? `P${String(planned.ticketNumber).padStart(3, "0")}` : String(planned.ticketNumber).padStart(3, "0"))
                        : planned.ticketCode)}
                  </div>

                  {planned.originalExpectedSlotTime && (
                    <div className="tabular" style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                      本来: {planned.originalExpectedSlotTime}
                    </div>
                  )}
                  {planned.originalExpectedSlotTime &&
                    planned.expectedSlotTime &&
                    planned.originalExpectedSlotTime !== planned.expectedSlotTime && (
                      <div className="tabular" style={{ fontSize: "0.68rem", color: "#fbbf24" }}>
                        本来 {planned.originalExpectedSlotTime} → 最新 {planned.expectedSlotTime}
                      </div>
                    )}

                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                    未確定
                  </div>
                </div>
              );
            }

            // 3. 空席（メンテナンス中 または 通常空席）
            if (seat.is_maintenance) {
              return (
                <div
                  key={seat.id}
                  className="seat-card empty"
                  style={{
                    background: "rgba(234, 179, 8, 0.05)",
                    border: "1px dashed rgba(234, 179, 8, 0.3)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="seat-no-badge">{seat.seat_no}席</span>
                    <span className="seat-status-label" style={{ color: "#facc15" }}>
                      メンテナンス中
                    </span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "auto" }}>
                    割当不可
                  </div>
                </div>
              );
            }

            return (
              <div
                key={seat.id}
                className="seat-card empty"
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="seat-no-badge">{seat.seat_no}席</span>
                  <span className="seat-status-label" style={{ color: "var(--text-muted)" }}>
                    空席
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "auto" }}>
                  予定なし
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* 上部ヘッダー情報 */}
      <div className="card" style={{ marginBottom: "14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--text-main)" }}>
                待機中の到着客:
              </span>
              <span
                className="status-pill"
                style={{
                  background: unassignedCheckedInCount > 0 ? "rgba(245, 158, 11, 0.15)" : "var(--bg-surface-hover)",
                  color: unassignedCheckedInCount > 0 ? "#fbbf24" : "var(--text-secondary)",
                  fontSize: "0.85rem",
                  fontWeight: "700",
                }}
              >
                {unassignedCheckedInCount}名
              </span>
            </div>

            {bufferSummary && bufferSummary.totalBufferSlots > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  className="status-pill"
                  style={{
                    background: "rgba(192, 132, 252, 0.15)",
                    color: "#c084fc",
                    border: "1px solid rgba(192, 132, 252, 0.35)",
                    fontSize: "0.8rem",
                    fontWeight: "600",
                  }}
                >
                  調整枠空き: {bufferSummary.remainingBufferSeats}席 (遅刻待ち: {bufferSummary.unassignedDelayedCount}名)
                </span>
                {bufferSummary.canAccommodate ? (
                  <span
                    className="status-pill"
                    style={{
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "#34d399",
                      border: "1px solid rgba(16, 185, 129, 0.35)",
                      fontSize: "0.75rem",
                      fontWeight: "600",
                    }}
                  >
                    調整枠案内可能
                  </span>
                ) : (
                  <span
                    className="status-pill"
                    style={{
                      background: "rgba(245, 158, 11, 0.15)",
                      color: "#fbbf24",
                      border: "1px solid rgba(245, 158, 11, 0.35)",
                      fontSize: "0.75rem",
                      fontWeight: "600",
                    }}
                  >
                    調整枠不足注意
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={fetchData}
            title="最新の状態に更新"
          >
            <RefreshCwIcon size={14} />
            <span>更新</span>
          </button>
        </div>
      </div>

      {/* モバイル用セグメント切り替えコントロール */}
      <div className="segment-control">
        <button
          type="button"
          className={`segment-btn ${mobileFilter === "unassigned" ? "active" : ""}`}
          onClick={() => setMobileFilter("unassigned")}
        >
          <span>未案内スロット</span>
          <span className="nav-badge" style={{ background: "var(--primary)", color: "#fff" }}>
            {unassignedSlots.length}
          </span>
        </button>
        <button
          type="button"
          className={`segment-btn ${mobileFilter === "assigned" ? "active" : ""}`}
          onClick={() => setMobileFilter("assigned")}
        >
          <span>案内済スロット</span>
          <span className="nav-badge" style={{ background: "var(--border-medium)", color: "var(--text-main)" }}>
            {assignedSlots.length}
          </span>
        </button>
        <button
          type="button"
          className={`segment-btn ${mobileFilter === "all" ? "active" : ""}`}
          onClick={() => setMobileFilter("all")}
        >
          <span>2列表示</span>
        </button>
      </div>

      {/* スロット一覧グリッド */}
      <div
        className={mobileFilter === "all" ? "assignment-split-layout" : ""}
        style={mobileFilter !== "all" ? { width: "100%" } : undefined}
      >
        {/* 左側：未案内スロット（早い順） */}
        {(mobileFilter === "unassigned" || mobileFilter === "all") && (
          <div className="assignment-col-box">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                padding: "0 4px",
              }}
            >
              <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "#38bdf8" }}>
                未案内枠（直近順）
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {unassignedSlots.length}枠
              </span>
            </div>

            {unassignedSlots.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 16px",
                  color: "var(--text-muted)",
                  border: "1px dashed var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.88rem",
                }}
              >
                未案内のスロットはありません
              </div>
            ) : (
              unassignedSlots.map((slot) => renderSlotCard(slot))
            )}
          </div>
        )}

        {/* 右側：案内済みスロット（最新順） */}
        {(mobileFilter === "assigned" || mobileFilter === "all") && (
          <div className="assignment-col-box">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "8px",
                padding: "0 4px",
              }}
            >
              <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "#34d399" }}>
                案内済枠（完了履歴）
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                {assignedSlots.length}枠
              </span>
            </div>

            {assignedSlots.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 16px",
                  color: "var(--text-muted)",
                  border: "1px dashed var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "0.88rem",
                }}
              >
                案内済みのスロットはありません
              </div>
            ) : (
              assignedSlots.map((slot) => renderSlotCard(slot))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
