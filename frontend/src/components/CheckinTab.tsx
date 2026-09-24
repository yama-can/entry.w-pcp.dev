import React, { useState } from "react";
import { TicketItem, BufferSummary } from "../types";
import { QrCodeIcon, RefreshCwIcon, UserXIcon } from "./Icons";

interface CheckinTabProps {
  checkinTickets: TicketItem[];
  ticketScanInput: string;
  setTicketScanInput: (v: string) => void;
  handleTicketScanSubmit: (e: React.FormEvent) => void;
  ticketInputRef: React.RefObject<HTMLInputElement | null>;
  attendanceSearch: string;
  setAttendanceSearch: (v: string) => void;
  handleMarkTicket: (ticketNumber: number, status: "checked_in" | "issued") => void;
  handleCancelTicket: (ticketNumber: number, e: React.MouseEvent) => void;
  fetchData: () => void;
  bufferSummary?: BufferSummary | null;
}

export const CheckinTab: React.FC<CheckinTabProps> = ({
  checkinTickets,
  ticketScanInput,
  setTicketScanInput,
  handleTicketScanSubmit,
  ticketInputRef,
  attendanceSearch,
  setAttendanceSearch,
  handleMarkTicket,
  handleCancelTicket,
  fetchData,
  bufferSummary,
}) => {
  // モバイル用表示タブ切り替え ('unarrived' | 'arrived' | 'all')
  const [mobileFilter, setMobileFilter] = useState<"unarrived" | "arrived" | "all">("unarrived");

  // 検索フィルタリング
  const searchLower = attendanceSearch.trim().toLowerCase();
  const searchedTickets = checkinTickets.filter((t) => {
    if (!searchLower) return true;
    const numStr = String(t.ticket_number);
    const codeStr = `no. ${t.ticket_number}`.toLowerCase();
    const game = (t.game_name || "").toLowerCase();
    return numStr.includes(searchLower) || codeStr.includes(searchLower) || game.includes(searchLower);
  });

  // 遅延判定ヘルパー関数
  const checkIsDelayed = (item: TicketItem) => {
    if (item.status === "assigned") return false;
    if (item.is_delayed !== undefined) return item.is_delayed;
    if (item.expected_slot_time) {
      const now = new Date();
      const [eH, eM] = item.expected_slot_time.split(":").map(Number);
      return (now.getHours() * 60 + now.getMinutes()) > (eH * 60 + eM);
    }
    return false;
  };

  // 案内待ち遅刻者（早く到着した順 = checked_in_at 昇順）
  // 遅刻者の中で早く来た順にランク付けする
  const waitingDelayedTickets = checkinTickets
    .filter((t) => t.status === "checked_in" && !t.assigned_slot_id && checkIsDelayed(t))
    .sort((a, b) => {
      const timeA = a.checked_in_at ? new Date(a.checked_in_at).getTime() : 0;
      const timeB = b.checked_in_at ? new Date(b.checked_in_at).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;
      return a.ticket_number - b.ticket_number;
    });

  // チケットID -> 遅刻受付順位（1-indexed）のマップ
  const delayedOrderMap = new Map<number, number>();
  waitingDelayedTickets.forEach((t, idx) => {
    delayedOrderMap.set(t.id, idx + 1);
  });

  // 未到着 (status === 'issued') - 番号昇順
  const unarrivedTickets = searchedTickets
    .filter((t) => t.status === "issued")
    .sort((a, b) => a.ticket_number - b.ticket_number);

  // 到着済 (status === 'checked_in' または 'assigned') - 最新到着順（降順）
  const arrivedTickets = searchedTickets
    .filter((t) => t.status === "checked_in" || t.status === "assigned")
    .sort((a, b) => {
      if (a.checked_in_at && b.checked_in_at) {
        return new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime();
      }
      if (a.checked_in_at) return -1;
      if (b.checked_in_at) return 1;
      if (a.created_at && b.created_at) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return b.ticket_number - a.ticket_number;
    });

  const countUnarrivedTotal = checkinTickets.filter((t) => t.status === "issued").length;

  return (
    <div>
      {/* 上部：番号スキャン & 検索バー */}
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
          {/* 番号スキャン入力 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 240px" }}>
            <QrCodeIcon size={20} color="#34d399" />
            <form onSubmit={handleTicketScanSubmit} style={{ flex: 1 }}>
              <input
                ref={ticketInputRef}
                type="text"
                className="form-input tabular font-mono"
                style={{
                  fontSize: "1rem",
                  padding: "8px 12px",
                  borderColor: "var(--border-strong)",
                  width: "100%",
                }}
                placeholder="整理番号入力 または スキャン (Enter)"
                value={ticketScanInput}
                onChange={(e) => setTicketScanInput(e.target.value)}
              />
            </form>
          </div>

          {/* 検索 & 更新 */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center", width: "auto" }}>
            <input
              type="text"
              className="form-input"
              style={{ width: "140px", padding: "8px 10px", fontSize: "0.84rem" }}
              placeholder="絞り込み検索"
              value={attendanceSearch}
              onChange={(e) => setAttendanceSearch(e.target.value)}
            />
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
      </div>

      {/* 調整枠空き状況 & 遅刻者受入ステータスバー */}
      {bufferSummary && bufferSummary.totalBufferSlots > 0 && (
        <div
          className="card"
          style={{
            marginBottom: "14px",
            padding: "10px 14px",
            background: "rgba(15, 23, 42, 0.6)",
            border: "1px solid var(--border-medium)",
            borderLeft: `4px solid ${bufferSummary.canAccommodate ? "var(--buffer-color)" : "var(--warning)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "0.85rem", fontWeight: "700", color: "var(--text-main)" }}>
                調整枠 空き状況:
              </span>
              <span
                className="tabular font-mono"
                style={{
                  fontSize: "1rem",
                  fontWeight: "700",
                  color: bufferSummary.remainingBufferSeats > 0 ? "#c084fc" : "var(--text-muted)",
                }}
              >
                {bufferSummary.remainingBufferSeats} 席
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                (全{bufferSummary.totalBufferSeats}席 / 未案内{bufferSummary.remainingBufferSlots}枠)
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                遅刻案内待ち:
              </span>
              <span
                className="tabular font-mono"
                style={{
                  fontSize: "0.95rem",
                  fontWeight: "700",
                  color: bufferSummary.unassignedDelayedCount > 0 ? "#fbbf24" : "var(--text-main)",
                }}
              >
                {bufferSummary.unassignedDelayedCount} 名
              </span>
            </div>

            {bufferSummary.unarrivedDelayedCount > 0 && (
              <span style={{ fontSize: "0.75rem", color: "#f87171" }}>
                (※未到着の遅刻予定: {bufferSummary.unarrivedDelayedCount}名)
              </span>
            )}
          </div>

          <div>
            {bufferSummary.canAccommodate ? (
              <span
                className="status-pill"
                style={{
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "#34d399",
                  border: "1px solid rgba(16, 185, 129, 0.35)",
                  fontSize: "0.78rem",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                  fontWeight: "700",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                調整枠にて確実に案内可能 (余り {bufferSummary.seatsDiff} 席)
              </span>
            ) : (
              <span
                className="status-pill"
                style={{
                  background: "rgba(245, 158, 11, 0.15)",
                  color: "#fbbf24",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  fontSize: "0.78rem",
                  padding: "4px 10px",
                  borderRadius: "9999px",
                  fontWeight: "700",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
                調整枠不足 (遅刻待ち{bufferSummary.unassignedDelayedCount}名 / 調整枠{bufferSummary.remainingBufferSeats}席)
              </span>
            )}
          </div>
        </div>
      )}

      {/* モバイル用セグメント切り替えコントロール */}
      <div className="segment-control">
        <button
          type="button"
          className={`segment-btn ${mobileFilter === "unarrived" ? "active" : ""}`}
          onClick={() => setMobileFilter("unarrived")}
        >
          <span>未到着</span>
          <span className="nav-badge nav-badge-danger">{unarrivedTickets.length}</span>
        </button>
        <button
          type="button"
          className={`segment-btn ${mobileFilter === "arrived" ? "active" : ""}`}
          onClick={() => setMobileFilter("arrived")}
        >
          <span>到着済</span>
          <span className="nav-badge" style={{ background: "var(--border-medium)", color: "var(--text-main)" }}>
            {arrivedTickets.length}
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

      {/* リスト表示グリッド */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: mobileFilter === "all" ? "repeat(auto-fit, minmax(320px, 1fr))" : "1fr",
          gap: "14px",
          alignItems: "start",
        }}
      >
        {/* =========================================================
            未到着リスト（これから受付対応する人）
        ========================================================= */}
        {(mobileFilter === "unarrived" || mobileFilter === "all") && (
          <div
            className="card"
            style={{
              borderLeft: "3px solid var(--danger)",
              padding: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
                paddingBottom: "8px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "#fca5a5" }}>
                  未到着
                </span>
                <span className="nav-badge nav-badge-danger">
                  {unarrivedTickets.length}名
                </span>
              </div>
              {countUnarrivedTotal > 0 && (
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  全体: {countUnarrivedTotal}名
                </span>
              )}
            </div>

            {unarrivedTickets.length === 0 ? (
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
                {searchLower
                  ? "条件に一致する未到着の整理券はありません"
                  : "現在、未到着の方はいません（全員到着済み）"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "72vh", overflowY: "auto", paddingRight: "2px" }}>
                {unarrivedTickets.map((item) => {
                  const isDelayed = checkIsDelayed(item);

                  return (
                    <div
                      key={item.id}
                      className="checkin-row-item"
                      style={{
                        borderLeft: isDelayed ? "3px solid #ef4444" : undefined,
                        background: isDelayed ? "rgba(239, 68, 68, 0.04)" : undefined,
                      }}
                    >
                      <div>
                        {/* 整理番号 ＆ 丸い小さなステータスタグ */}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className="tabular font-mono" style={{ fontSize: "1.15rem", fontWeight: "700", color: "#38bdf8" }}>
                            No. {item.ticket_number}
                          </span>

                          {/* ★ 丸い小さなタグ（遅延/定刻） */}
                          {isDelayed ? (
                            <>
                              <span
                                className="status-pill"
                                style={{
                                  background: "rgba(239, 68, 68, 0.15)",
                                  color: "#f87171",
                                  border: "1px solid rgba(239, 68, 68, 0.35)",
                                  fontSize: "0.68rem",
                                  padding: "2px 7px",
                                  borderRadius: "9999px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontWeight: "700",
                                }}
                                title="予定時間を超過した遅刻者"
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
                                遅延
                              </span>
                              {bufferSummary && bufferSummary.totalBufferSlots > 0 && (
                                <span
                                  className="status-pill"
                                  style={{
                                    background: bufferSummary.canAccommodate ? "rgba(16, 185, 129, 0.1)" : "rgba(245, 158, 11, 0.1)",
                                    color: bufferSummary.canAccommodate ? "#34d399" : "#fbbf24",
                                    border: `1px solid ${bufferSummary.canAccommodate ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.25)"}`,
                                    fontSize: "0.68rem",
                                    padding: "2px 7px",
                                    borderRadius: "9999px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "4px",
                                    fontWeight: "600",
                                  }}
                                  title={`調整枠残席: ${bufferSummary.remainingBufferSeats}席`}
                                >
                                  調整枠空き: {bufferSummary.remainingBufferSeats}席
                                </span>
                              )}
                            </>
                          ) : (
                            <span
                              className="status-pill"
                              style={{
                                background: "rgba(16, 185, 129, 0.1)",
                                color: "#34d399",
                                border: "1px solid rgba(16, 185, 129, 0.25)",
                                fontSize: "0.68rem",
                                padding: "2px 7px",
                                borderRadius: "9999px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontWeight: "600",
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                              定刻
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: "0.85rem", color: "var(--text-main)", fontWeight: "600", marginTop: "2px" }}>
                          {item.game_name || "未指定"}
                        </div>
                        {item.expected_slot_time && (
                          <div className="tabular" style={{ fontSize: "0.75rem", color: isDelayed ? "#f87171" : "var(--text-secondary)", marginTop: "2px" }}>
                            予定枠: {item.expected_slot_time} {item.expected_lane ? `(${item.expected_lane}組)` : ""}
                          </div>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleMarkTicket(item.ticket_number, "checked_in")}
                          style={{
                            background: "var(--success)",
                            padding: "8px 16px",
                            fontWeight: "700",
                            fontSize: "0.9rem",
                          }}
                          title="到着済みに更新"
                        >
                          到着
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleCancelTicket(item.ticket_number, e)}
                          style={{
                            background: "transparent",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border-subtle)",
                            padding: "7px 9px",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                          title="取消処理"
                        >
                          <UserXIcon size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* =========================================================
            到着済リスト（案内待ち or 案内済み）
        ========================================================= */}
        {(mobileFilter === "arrived" || mobileFilter === "all") && (
          <div
            className="card"
            style={{
              borderLeft: "3px solid var(--success)",
              padding: "14px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
                paddingBottom: "8px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "#86efac" }}>
                  到着済
                </span>
                <span className="nav-badge" style={{ background: "var(--border-medium)", color: "#fff" }}>
                  {arrivedTickets.length}名
                </span>
              </div>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                最新到着順
              </span>
            </div>

            {arrivedTickets.length === 0 ? (
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
                現在、到着済みの整理券はありません
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "72vh", overflowY: "auto", paddingRight: "2px" }}>
                {arrivedTickets.map((item) => {
                  const isAssigned = item.status === "assigned";
                  const isDelayed = checkIsDelayed(item);
                  const arrivedTimeStr = item.checked_in_at
                    ? new Date(item.checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                    : null;

                  return (
                    <div
                      key={item.id}
                      className="checkin-row-item"
                      style={{
                        borderLeft: isDelayed ? "3px solid #f59e0b" : undefined,
                        background: isAssigned ? "rgba(15, 23, 42, 0.4)" : isDelayed ? "rgba(245, 158, 11, 0.04)" : "var(--bg-card)",
                        opacity: isAssigned ? 0.75 : 1,
                      }}
                    >
                      <div>
                        {/* 整理番号 ＆ 丸い小さなステータスタグ */}
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span className="tabular font-mono" style={{ fontSize: "1.1rem", fontWeight: "700", color: isAssigned ? "var(--text-secondary)" : "#f8fafc" }}>
                            No. {item.ticket_number}
                          </span>

                          {/* ★ 丸い小さなタグ（遅延/定刻/案内済） */}
                          {isAssigned ? (
                            <span
                              className="status-pill"
                              style={{
                                background: "var(--bg-surface-hover)",
                                color: "var(--text-muted)",
                                border: "1px solid var(--border-subtle)",
                                fontSize: "0.68rem",
                                padding: "2px 7px",
                                borderRadius: "9999px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#94a3b8" }} />
                              案内済
                            </span>
                          ) : isDelayed ? (
                            <>
                              <span
                                className="status-pill"
                                style={{
                                  background: "rgba(245, 158, 11, 0.15)",
                                  color: "#fbbf24",
                                  border: "1px solid rgba(245, 158, 11, 0.35)",
                                  fontSize: "0.68rem",
                                  padding: "2px 7px",
                                  borderRadius: "9999px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontWeight: "700",
                                }}
                                title="予定時間を超過した遅延者"
                              >
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
                                遅延
                              </span>
                              {delayedOrderMap.has(item.id) && (() => {
                                const order = delayedOrderMap.get(item.id)!;
                                const remSeats = bufferSummary?.remainingBufferSeats ?? 0;
                                const willFitBuffer = order <= remSeats;
                                return (
                                  <span
                                    className="status-pill"
                                    style={{
                                      background: willFitBuffer ? "rgba(192, 132, 252, 0.15)" : "rgba(245, 158, 11, 0.15)",
                                      color: willFitBuffer ? "#c084fc" : "#fbbf24",
                                      border: `1px solid ${willFitBuffer ? "rgba(192, 132, 252, 0.35)" : "rgba(245, 158, 11, 0.35)"}`,
                                      fontSize: "0.68rem",
                                      padding: "2px 7px",
                                      borderRadius: "9999px",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "4px",
                                      fontWeight: "600",
                                    }}
                                    title={`遅刻到着順 第${order}位（到着が早い順に優先割当）`}
                                  >
                                    受付順 #{order} {willFitBuffer ? "・調整枠見込み" : "・空き枠調整"}
                                  </span>
                                );
                              })()}
                            </>
                          ) : (
                            <span
                              className="status-pill"
                              style={{
                                background: "rgba(16, 185, 129, 0.1)",
                                color: "#34d399",
                                border: "1px solid rgba(16, 185, 129, 0.25)",
                                fontSize: "0.68rem",
                                padding: "2px 7px",
                                borderRadius: "9999px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                fontWeight: "600",
                              }}
                            >
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
                              案内待ち
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                          {item.game_name || "未指定"}
                        </div>
                        <div className="tabular" style={{ fontSize: "0.72rem", color: isDelayed ? "#fbbf24" : "var(--text-muted)", marginTop: "2px" }}>
                          {arrivedTimeStr ? `${arrivedTimeStr} 到着` : "到着済"}
                          {item.expected_slot_time ? ` (予定: ${item.expected_slot_time})` : ""}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        {!isAssigned ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => handleMarkTicket(item.ticket_number, "issued")}
                            style={{ padding: "6px 10px", fontSize: "0.78rem" }}
                            title="未到着に戻す"
                          >
                            未着に戻す
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={(e) => handleCancelTicket(item.ticket_number, e)}
                          style={{
                            background: "transparent",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border-subtle)",
                            padding: "6px 8px",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                          }}
                          title="取消処理"
                        >
                          <UserXIcon size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
