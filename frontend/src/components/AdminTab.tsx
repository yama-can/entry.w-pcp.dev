import React from "react";
import { Game, SlotTimeline, WaitStatus, SeatReservation } from "../types";
import {
  ClockIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
  SettingsIcon,
} from "./Icons";
import { getLaneTheme } from "../utils/theme";

interface AdminTabProps {
  adminFormRef: React.RefObject<HTMLDivElement | null>;
  targetDay: number;
  setTargetDay: (d: number) => void;
  genMode: "all" | "from_slot" | "append";
  setGenMode: (m: "all" | "from_slot" | "append") => void;
  selectedFromSlotId: string;
  setSelectedFromSlotId: (id: string) => void;
  startHour: string;
  setStartHour: (v: string) => void;
  startMinute: string;
  setStartMinute: (v: string) => void;
  endHour: string;
  setEndHour: (v: string) => void;
  endMinute: string;
  setEndMinute: (v: string) => void;
  slotCount: string;
  setSlotCount: (v: string) => void;
  seatsPerSlot: string;
  setSeatsPerSlot: (v: string) => void;
  lanesInput: string;
  setLanesInput: (v: string) => void;
  playDuration: string;
  setPlayDuration: (v: string) => void;
  cleanupDuration: string;
  setCleanupDuration: (v: string) => void;
  laneOffset: string;
  setLaneOffset: (v: string) => void;
  bufferDuration: string;
  setBufferDuration: (v: string) => void;
  bufferInterval: string;
  setBufferInterval: (v: string) => void;
  updateCountFromTime: (
    sH: string,
    sM: string,
    eH: string,
    eM: string,
    pDur?: string,
    cDur?: string,
    lns?: string
  ) => void;
  updateEndFromCount: (
    sH: string,
    sM: string,
    count: string,
    pDur?: string,
    cDur?: string,
    lns?: string
  ) => void;
  getAvgSlotDur: (pDur?: string, cDur?: string, lns?: string) => number;
  handleGenerateOrAdjustSlots: (e: React.FormEvent) => void;
  waitStatus: WaitStatus | null;
  maxWaitLimitInput: string;
  setMaxWaitLimitInput: (v: string) => void;
  handleUpdateMaxWait: (minutes: number) => void;
  meetingLeadInput: string;
  setMeetingLeadInput: (v: string) => void;
  handleUpdateMeetingLead: (minutes: number) => void;
  newGameId: string;
  setNewGameId: (v: string) => void;
  newGameName: string;
  setNewGameName: (v: string) => void;
  newGameCmd: string;
  setNewGameCmd: (v: string) => void;
  handleSaveGame: (e: React.FormEvent) => void;
  handleDeleteGame: (id: string) => void;
  games: Game[];
  timeline: SlotTimeline[];
  activeDay: number;
  dynamicLanes: string[];
  handleUpdateSlot: (
    slotId: number,
    updates: {
      lane?: string;
      durationMinutes?: number;
      playDuration?: number;
      cleanupDuration?: number;
    }
  ) => void;
  handleShiftDelay: (slotId: number, shiftMinutes: number) => void;
  handleToggleBuffer: (slotId: number) => void;
  handleToggleMaintenance: (slotId: number) => void;
  setQuickAdjust: (slot: SlotTimeline) => void;
  isAdminLoggedIn: boolean;
  onLogin: (password: string) => Promise<boolean>;
  onLogout: () => void;
}

export const AdminTab: React.FC<AdminTabProps> = ({
  adminFormRef,
  targetDay,
  setTargetDay,
  genMode,
  setGenMode,
  selectedFromSlotId,
  setSelectedFromSlotId,
  startHour,
  setStartHour,
  startMinute,
  setStartMinute,
  endHour,
  setEndHour,
  endMinute,
  setEndMinute,
  slotCount,
  setSlotCount,
  seatsPerSlot,
  setSeatsPerSlot,
  lanesInput,
  setLanesInput,
  playDuration,
  setPlayDuration,
  cleanupDuration,
  setCleanupDuration,
  laneOffset,
  setLaneOffset,
  bufferDuration,
  setBufferDuration,
  bufferInterval,
  setBufferInterval,
  updateCountFromTime,
  updateEndFromCount,
  getAvgSlotDur,
  handleGenerateOrAdjustSlots,
  waitStatus,
  maxWaitLimitInput,
  setMaxWaitLimitInput,
  handleUpdateMaxWait,
  meetingLeadInput,
  setMeetingLeadInput,
  handleUpdateMeetingLead,
  newGameId,
  setNewGameId,
  newGameName,
  setNewGameName,
  newGameCmd,
  setNewGameCmd,
  handleSaveGame,
  handleDeleteGame,
  games,
  timeline,
  activeDay,
  dynamicLanes,
  handleUpdateSlot,
  handleShiftDelay,
  handleToggleBuffer,
  handleToggleMaintenance,
  setQuickAdjust,
  isAdminLoggedIn,
  onLogin,
  onLogout,
}) => {
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [loginError, setLoginError] = React.useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setLoginError(null);
    try {
      const ok = await onLogin(password);
      if (!ok) {
        setLoginError("パスワードが正しくありません");
      } else {
        setPassword("");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdminLoggedIn) {
    return (
      <div style={{ maxWidth: "420px", margin: "40px auto 0", padding: "0 12px" }}>
        <div className="card" style={{ padding: "28px 24px", border: "1px solid #334155" }}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                background: "rgba(59, 130, 246, 0.15)",
                color: "#60a5fa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 10px",
              }}
            >
              <SettingsIcon size={20} color="#38bdf8" />
            </div>
            <h2 style={{ fontSize: "1.15rem", fontWeight: "700", color: "#f8fafc", margin: 0 }}>
              管理者認証
            </h2>
            <p style={{ fontSize: "0.82rem", color: "#94a3b8", marginTop: "4px" }}>
              設定・タイムテーブル編集にはパスワードが必要です
            </p>
          </div>

          <form onSubmit={handleLoginSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.8rem",
                  fontWeight: "600",
                  color: "#cbd5e1",
                  marginBottom: "6px",
                }}
              >
                パスワード
              </label>
              <input
                type="password"
                className="input"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "0.95rem",
                  boxSizing: "border-box",
                }}
                placeholder="管理者パスワードを入力"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
            </div>

            {loginError && (
              <div
                style={{
                  fontSize: "0.85rem",
                  color: "#f87171",
                  background: "rgba(239, 68, 68, 0.1)",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                }}
              >
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting || !password}
              style={{
                width: "100%",
                padding: "10px",
                fontWeight: "600",
                fontSize: "0.95rem",
                marginTop: "4px",
              }}
            >
              {submitting ? "認証中..." : "ログイン"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ログイン情報バー */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "rgba(30, 41, 59, 0.7)",
          border: "1px solid #334155",
          borderRadius: "8px",
          padding: "8px 14px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.82rem", color: "#10b981", fontWeight: "600" }}>
          <span>●</span> 管理者認証中
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="btn"
          style={{
            fontSize: "0.78rem",
            padding: "4px 10px",
            background: "rgba(239, 68, 68, 0.15)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            cursor: "pointer",
            borderRadius: "4px",
          }}
        >
          ログアウト
        </button>
      </div>

      <div className="admin-grid">
        {/* スロット生成 / ある時点以降の調整フォーム */}
        <div className="card" ref={adminFormRef}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
              スロット生成・スケジュール調整
            </h3>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>対象日程:</span>
              <button
                type="button"
                className={`day-btn ${targetDay === 1 ? "active" : ""}`}
                onClick={() => setTargetDay(1)}
              >
                Day 1
              </button>
              <button
                type="button"
                className={`day-btn ${targetDay === 2 ? "active" : ""}`}
                onClick={() => setTargetDay(2)}
              >
                Day 2
              </button>
            </div>
          </div>

          {/* 生成モード切替 */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              marginBottom: "16px",
              background: "#0f172a",
              padding: "4px",
              borderRadius: "8px",
            }}
          >
            <button
              type="button"
              style={{
                flex: 1,
                padding: "8px 12px",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: "bold",
                cursor: "pointer",
                background: genMode === "all" ? "#3b82f6" : "transparent",
                color: genMode === "all" ? "#fff" : "#94a3b8",
              }}
              onClick={() => setGenMode("all")}
            >
              最初から全初期化
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: "8px 12px",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: "bold",
                cursor: "pointer",
                background: genMode === "from_slot" ? "#3b82f6" : "transparent",
                color: genMode === "from_slot" ? "#fff" : "#94a3b8",
              }}
              onClick={() => setGenMode("from_slot")}
            >
              指定枠以降を調整
            </button>
            <button
              type="button"
              style={{
                flex: 1,
                padding: "8px 12px",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: "bold",
                cursor: "pointer",
                background: genMode === "append" ? "#3b82f6" : "transparent",
                color: genMode === "append" ? "#fff" : "#94a3b8",
              }}
              onClick={() => setGenMode("append")}
            >
              末尾に追加
            </button>
          </div>

          <form onSubmit={handleGenerateOrAdjustSlots}>
            {genMode === "from_slot" && (
              <div
                className="form-group"
                style={{
                  background: "rgba(59, 130, 246, 0.1)",
                  padding: "10px 12px",
                  borderRadius: "8px",
                  border: "1px solid #3b82f6",
                }}
              >
                <label className="form-label" style={{ color: "#60a5fa" }}>
                  起点スロット（以降の枠を再生成）
                </label>
                <select
                  className="form-input"
                  value={selectedFromSlotId}
                  onChange={(e) => {
                    setSelectedFromSlotId(e.target.value);
                    const s = timeline.find((slot) => String(slot.id) === e.target.value);
                    if (s) {
                      const [h, m] = s.slot_time.split(":");
                      setStartHour(h);
                      setStartMinute(m);
                      updateEndFromCount(h, m, slotCount);
                    }
                  }}
                  required
                >
                  {timeline.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.slot_time} 【{s.lane}組】(#{s.order_idx + 1}){" "}
                      {s.is_buffer ? "[調整枠]" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 開始時刻 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">
                  {genMode === "append" ? "開始 時 (省略時は継続)" : "開始 時"}
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={startHour}
                  onChange={(e) => {
                    setStartHour(e.target.value);
                    updateCountFromTime(e.target.value, startMinute, endHour, endMinute);
                  }}
                  min={0}
                  max={23}
                  required={genMode !== "append"}
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  {genMode === "append" ? "開始 分 (省略時は継続)" : "開始 分"}
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={startMinute}
                  onChange={(e) => {
                    setStartMinute(e.target.value);
                    updateCountFromTime(startHour, e.target.value, endHour, endMinute);
                  }}
                  min={0}
                  max={59}
                  required={genMode !== "append"}
                />
              </div>
            </div>

            {/* 終了時刻の指定 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">終了 時</label>
                <input
                  type="number"
                  className="form-input"
                  value={endHour}
                  onChange={(e) => {
                    setEndHour(e.target.value);
                    updateCountFromTime(
                      startHour,
                      startMinute,
                      e.target.value,
                      endMinute,
                      playDuration,
                      cleanupDuration,
                      lanesInput
                    );
                  }}
                  min={0}
                  max={23}
                />
              </div>
              <div className="form-group">
                <label className="form-label">終了 分</label>
                <input
                  type="number"
                  className="form-input"
                  value={endMinute}
                  onChange={(e) => {
                    setEndMinute(e.target.value);
                    updateCountFromTime(
                      startHour,
                      startMinute,
                      endHour,
                      e.target.value,
                      playDuration,
                      cleanupDuration,
                      lanesInput
                    );
                  }}
                  min={0}
                  max={59}
                />
              </div>
            </div>

            {/* 枠数 & 席数 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">
                  枠数
                  <span style={{ fontSize: "0.75rem", color: "#38bdf8", marginLeft: "6px" }}>
                    (平均{getAvgSlotDur().toFixed(1)}分 / 終了目安 {endHour}:{endMinute})
                  </span>
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={slotCount}
                  onChange={(e) => {
                    setSlotCount(e.target.value);
                    updateEndFromCount(
                      startHour,
                      startMinute,
                      e.target.value,
                      playDuration,
                      cleanupDuration,
                      lanesInput
                    );
                  }}
                  min={1}
                  max={200}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">1枠席数</label>
                <input
                  type="number"
                  className="form-input"
                  value={seatsPerSlot}
                  onChange={(e) => setSeatsPerSlot(e.target.value)}
                  min={1}
                  max={12}
                  required
                />
              </div>
            </div>

            {/* レーン構成 */}
            <div
              className="form-group"
              style={{
                background: "#0f172a",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid #334155",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "6px",
                }}
              >
                <label
                  className="form-label"
                  style={{ fontWeight: "bold", color: "#38bdf8", margin: 0 }}
                >
                  運用レーン (カンマ区切り)
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setLanesInput("A, B");
                      setLaneOffset("3");
                      updateCountFromTime(
                        startHour,
                        startMinute,
                        endHour,
                        endMinute,
                        playDuration,
                        cleanupDuration,
                        "A, B"
                      );
                    }}
                    style={{
                      fontSize: "0.75rem",
                      background: "#1e293b",
                      color: "#cbd5e1",
                      border: "1px solid #475569",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    A, B (2系統)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLanesInput("A, B, C");
                      setLaneOffset("2");
                      updateCountFromTime(
                        startHour,
                        startMinute,
                        endHour,
                        endMinute,
                        playDuration,
                        cleanupDuration,
                        "A, B, C"
                      );
                    }}
                    style={{
                      fontSize: "0.75rem",
                      background: "#1e293b",
                      color: "#cbd5e1",
                      border: "1px solid #475569",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    A, B, C (3系統)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLanesInput("A");
                      setLaneOffset("7");
                      updateCountFromTime(
                        startHour,
                        startMinute,
                        endHour,
                        endMinute,
                        playDuration,
                        cleanupDuration,
                        "A"
                      );
                    }}
                    style={{
                      fontSize: "0.75rem",
                      background: "#1e293b",
                      color: "#cbd5e1",
                      border: "1px solid #475569",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Aのみ (単一系統)
                  </button>
                </div>
              </div>
              <input
                type="text"
                className="form-input"
                value={lanesInput}
                onChange={(e) => {
                  setLanesInput(e.target.value);
                  updateCountFromTime(
                    startHour,
                    startMinute,
                    endHour,
                    endMinute,
                    playDuration,
                    cleanupDuration,
                    e.target.value
                  );
                }}
                placeholder="例: A, B  または  A, B, C  または  A"
                required
              />
            </div>

            {/* 拘束時間＋入れ替え時間、レーンオフセット、調整枠 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: "12px",
              }}
            >
              <div className="form-group">
                <label className="form-label" style={{ color: "#4ade80", fontWeight: "bold" }}>
                  体験時間 (分)
                </label>
                <input
                  type="number"
                  className="form-input"
                  style={{ borderColor: "#22c55e" }}
                  value={playDuration}
                  onChange={(e) => {
                    setPlayDuration(e.target.value);
                    updateCountFromTime(
                      startHour,
                      startMinute,
                      endHour,
                      endMinute,
                      e.target.value,
                      cleanupDuration,
                      lanesInput
                    );
                  }}
                  min={1}
                  max={60}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: "#fbbf24", fontWeight: "bold" }}>
                  入替時間 (分)
                </label>
                <input
                  type="number"
                  className="form-input"
                  style={{ borderColor: "#f59e0b" }}
                  value={cleanupDuration}
                  onChange={(e) => {
                    setCleanupDuration(e.target.value);
                    updateCountFromTime(
                      startHour,
                      startMinute,
                      endHour,
                      endMinute,
                      playDuration,
                      e.target.value,
                      lanesInput
                    );
                  }}
                  min={0}
                  max={30}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: "#38bdf8", fontWeight: "bold" }}>
                  レーンずらし (分)
                </label>
                <input
                  type="number"
                  className="form-input"
                  style={{ borderColor: "#0284c7" }}
                  value={laneOffset}
                  onChange={(e) => setLaneOffset(e.target.value)}
                  min={1}
                  max={30}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: "#c4b5fd" }}>
                  調整枠 (分)
                </label>
                <input
                  type="number"
                  className="form-input"
                  value={bufferDuration}
                  onChange={(e) => setBufferDuration(e.target.value)}
                  min={1}
                  max={60}
                  required
                />
              </div>
            </div>

            <div
              style={{
                fontSize: "0.8rem",
                color: "#94a3b8",
                background: "rgba(15, 23, 42, 0.6)",
                padding: "8px 12px",
                borderRadius: "6px",
                marginBottom: "8px",
              }}
            >
              <strong>運用サイクル:</strong> 同一レーン次回まで【
              {(parseInt(playDuration) || 5) + (parseInt(cleanupDuration) || 2)}分】（体験
              {playDuration}分 ＋ 入替{cleanupDuration}分）。レーン間 {laneOffset}分ずらし。
            </div>

            <div className="form-group">
              <label className="form-label">
                調整枠の自動挿入間隔
                <span style={{ fontSize: "0.78rem", color: "#94a3b8", marginLeft: "8px" }}>
                  (例: 4なら4枠ごとに1枠挿入。0で無効)
                </span>
              </label>
              <input
                type="number"
                className="form-input"
                value={bufferInterval}
                onChange={(e) => setBufferInterval(e.target.value)}
                min={0}
                max={20}
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{
                width: "100%",
                justifyContent: "center",
                background: genMode === "all" ? "#ef4444" : "#3b82f6",
              }}
            >
              <RefreshCwIcon size={18} />
              {genMode === "all" &&
                `Day ${targetDay} スロット一括生成 (${slotCount}枠)`}
              {genMode === "from_slot" &&
                `Day ${targetDay} 指定枠以降を再生成 (${slotCount}枠)`}
              {genMode === "append" &&
                `Day ${targetDay} 末尾に枠を追加 (${slotCount}枠)`}
            </button>
          </form>
        </div>

        {/* 混雑・最大許容待ち時間制限設定 */}
        <div className="card" style={{ borderLeft: "4px solid #f59e0b" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <h3
              style={{
                fontSize: "1.1rem",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <ClockIcon size={18} color="#f59e0b" />
              最大許容待ち時間設定
            </h3>
            <span
              style={{
                fontSize: "0.82rem",
                color: waitStatus?.canIssue ? "#22c55e" : "#ef4444",
                fontWeight: "bold",
              }}
            >
              {waitStatus?.canIssue ? "● 発券受付中" : "● 発券停止中"}
            </span>
          </div>
          <p
            style={{
              fontSize: "0.82rem",
              color: "var(--text-muted)",
              marginBottom: "14px",
              lineHeight: "1.5",
            }}
          >
            待ち時間が設定分数を超えると自動で発券を一時停止します（0で制限無効）。
          </p>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
            <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
              <label className="form-label">最大待ち時間 (分)</label>
              <input
                type="number"
                className="form-input"
                value={maxWaitLimitInput}
                onChange={(e) => setMaxWaitLimitInput(e.target.value)}
                min={0}
                max={180}
                placeholder="例: 30"
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{
                background: "#f59e0b",
                color: "#000",
                fontWeight: "bold",
                padding: "8px 18px",
              }}
              onClick={() => handleUpdateMaxWait(parseInt(maxWaitLimitInput, 10) || 0)}
            >
              保存
            </button>
          </div>
        </div>

        {/* 集合時間（事前リードタイム）設定 */}
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
              集合時間設定
            </h3>
            <span
              style={{
                fontSize: "0.82rem",
                color: "#38bdf8",
                fontWeight: "bold",
              }}
            >
              現在: 開始 {meetingLeadInput || "5"} 分前
            </span>
          </div>
          <p
            style={{
              fontSize: "0.82rem",
              color: "var(--text-muted)",
              marginBottom: "14px",
              lineHeight: "1.5",
            }}
          >
            体験開始の何分前に集合場所へ案内するかを設定します（デフォルト5分前）。
          </p>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-group" style={{ flex: 1, minWidth: "180px", marginBottom: 0 }}>
              <label className="form-label">集合リードタイム (分前)</label>
              <input
                type="number"
                className="form-input"
                value={meetingLeadInput}
                onChange={(e) => setMeetingLeadInput(e.target.value)}
                min={0}
                max={30}
                placeholder="例: 5"
              />
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{
                background: "#38bdf8",
                color: "#000",
                fontWeight: "bold",
                padding: "8px 18px",
              }}
              onClick={() => handleUpdateMeetingLead(parseInt(meetingLeadInput, 10) || 5)}
            >
              保存
            </button>
          </div>
        </div>

        {/* ゲームマスタ管理 */}
        <div className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <h3 style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
              ゲームマスタ
            </h3>
            <span
              style={{
                fontSize: "0.78rem",
                color: "#38bdf8",
                background: "#0f172a",
                padding: "2px 8px",
                borderRadius: "4px",
              }}
            >
              両日共通マスタ
            </span>
          </div>
          <form onSubmit={handleSaveGame} style={{ marginBottom: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px" }}>
              <div className="form-group">
                <label className="form-label">ゲームID (QR値)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="例: ACT_01"
                  value={newGameId}
                  onChange={(e) => setNewGameId(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">画面表示名</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="例: 爆走バトル"
                  value={newGameName}
                  onChange={(e) => setNewGameName(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">起動コマンド / 実行ファイル名</label>
              <input
                type="text"
                className="form-input"
                placeholder="例: battle.exe"
                value={newGameCmd}
                onChange={(e) => setNewGameCmd(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary">
              <PlusIcon size={18} />
              ゲームを保存
            </button>
          </form>

          {/* 登録済みゲーム一覧 */}
          <h4
            style={{
              fontSize: "1rem",
              fontWeight: "bold",
              marginBottom: "8px",
              color: "var(--text-muted)",
            }}
          >
            登録済みゲーム一覧 ({games.length}件)
          </h4>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              maxHeight: "180px",
              overflowY: "auto",
            }}
          >
            {games.map((g) => (
              <div
                key={g.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#0f172a",
                  padding: "8px 12px",
                  borderRadius: "6px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontWeight: "bold",
                      color: "#38bdf8",
                      marginRight: "8px",
                    }}
                  >
                    [{g.id}]
                  </span>
                  <span>{g.name}</span>
                  {g.command && (
                    <span
                      style={{
                        color: "#94a3b8",
                        fontSize: "0.8rem",
                        marginLeft: "8px",
                      }}
                    >
                      ({g.command})
                    </span>
                  )}
                </div>
                <button
                  className="btn-danger"
                  style={{ padding: "4px 8px", fontSize: "0.75rem" }}
                  onClick={() => handleDeleteGame(g.id)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 全体タイムテーブル */}
      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
            flexWrap: "wrap",
            gap: "8px",
          }}
        >
          <h3 style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
            タイムテーブル Day {activeDay} (全{timeline.length}枠)
          </h3>
          <div
            style={{
              display: "flex",
              gap: "12px",
              fontSize: "0.85rem",
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{ width: 12, height: 12, background: "#334155", borderRadius: 2 }}
              />
              空席
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{ width: 12, height: 12, background: "#ca8a04", borderRadius: 2 }}
              />
              未着 (booked)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{ width: 12, height: 12, background: "#16a34a", borderRadius: 2 }}
              />
              到着済 (checked_in)
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
              <span
                style={{ width: 12, height: 12, background: "#8b5cf6", borderRadius: 2 }}
              />
              調整枠
            </span>
          </div>
        </div>

        <div className="timetable-scroll-box">
          <table className="timetable-table">
            <thead>
              <tr>
                <th>時間 (枠幅)</th>
                <th>レーン / 種別</th>
                <th>状態</th>
                <th>座席ステータス (1〜6番席)</th>
                <th>予約数</th>
                <th style={{ textAlign: "right" }}>現場クイック調整</th>
              </tr>
            </thead>
            <tbody>
              {timeline.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: "30px",
                      color: "var(--text-muted)",
                    }}
                  >
                    Day {activeDay} のスロットはまだありません。上のフォームから生成してください。
                  </td>
                </tr>
              ) : (
                timeline.map((slot) => {
                  const bookedCount = slot.seats.filter((s: SeatReservation) => s.status !== "empty").length;
                  return (
                    <tr key={slot.id} style={{ opacity: slot.is_closed ? 0.6 : 1 }}>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span
                            style={{
                              fontWeight: "bold",
                              fontSize: "1.15rem",
                              letterSpacing: "0.5px",
                            }}
                          >
                            {slot.slot_time}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <label style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                              次枠まで:
                            </label>
                            <select
                              value={slot.duration_minutes || 3}
                              onChange={(e) =>
                                handleUpdateSlot(slot.id, {
                                   durationMinutes: parseInt(e.target.value, 10),
                                })
                              }
                              style={{
                                background: "#1e293b",
                                color: "#38bdf8",
                                border: "1px solid #475569",
                                borderRadius: "4px",
                                padding: "1px 6px",
                                fontSize: "0.75rem",
                                fontWeight: "bold",
                                cursor: "pointer",
                              }}
                              title="この枠の時間を変更"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30].map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {m}分
                                  </option>
                                )
                              )}
                            </select>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <select
                              value={slot.lane}
                              onChange={(e) =>
                                handleUpdateSlot(slot.id, { lane: e.target.value })
                              }
                              style={{
                                background: getLaneTheme(slot.lane).bg,
                                color: "#ffffff",
                                border: `1px solid ${getLaneTheme(slot.lane).border}`,
                                borderRadius: "4px",
                                padding: "2px 6px",
                                fontSize: "0.85rem",
                                fontWeight: "900",
                                cursor: "pointer",
                              }}
                              title="この枠のレーンを変更"
                            >
                              {Array.from(
                                new Set([...dynamicLanes, "A", "B", "C", "D", "E"])
                              ).map((l) => (
                                <option
                                  key={l}
                                  value={l}
                                  style={{ background: "#1e293b", color: "#f8fafc" }}
                                >
                                  {l}組
                                </option>
                              ))}
                            </select>
                            {slot.is_maintenance ? (
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  background: "rgba(234, 179, 8, 0.2)",
                                  color: "#facc15",
                                  border: "1px solid rgba(234, 179, 8, 0.4)",
                                  fontWeight: "bold",
                                }}
                              >
                                メンテ
                              </span>
                            ) : slot.is_buffer ? (
                              <span
                                className="badge-buffer"
                                style={{ fontSize: "0.75rem", padding: "2px 6px" }}
                              >
                                調整
                              </span>
                            ) : null}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: "4px",
                              fontSize: "0.75rem",
                              color: "#cbd5e1",
                              alignItems: "center",
                            }}
                          >
                            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>体</span>
                            <select
                              value={slot.play_duration || 5}
                              onChange={(e) =>
                                handleUpdateSlot(slot.id, {
                                  playDuration: parseInt(e.target.value, 10),
                                })
                              }
                              style={{
                                background: "#1e293b",
                                color: "#4ade80",
                                border: "1px solid #16a34a",
                                borderRadius: "3px",
                                padding: "1px 4px",
                                fontSize: "0.7rem",
                                cursor: "pointer",
                              }}
                              title="体験時間"
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20].map((m) => (
                                <option key={m} value={m}>
                                  {m}分
                                </option>
                              ))}
                            </select>
                            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>替</span>
                            <select
                              value={
                                slot.cleanup_duration !== undefined
                                  ? slot.cleanup_duration
                                  : 2
                              }
                              onChange={(e) =>
                                handleUpdateSlot(slot.id, {
                                  cleanupDuration: parseInt(e.target.value, 10),
                                })
                              }
                              style={{
                                background: "#1e293b",
                                color: "#fbbf24",
                                border: "1px solid #d97706",
                                borderRadius: "3px",
                                padding: "1px 4px",
                                fontSize: "0.7rem",
                                cursor: "pointer",
                              }}
                              title="入れ替え時間"
                            >
                              {[0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((m) => (
                                <option key={m} value={m}>
                                  {m}分
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </td>
                      <td>
                        {slot.is_closed ? (
                          <span className="badge-closed">締切済</span>
                        ) : (
                          <span
                            style={{
                              color: "#22c55e",
                              fontSize: "0.8rem",
                              fontWeight: "bold",
                            }}
                          >
                            案内中
                          </span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "4px" }}>
                          {slot.seats.map((seat: SeatReservation) => {
                            const bg =
                              seat.status === "checked_in"
                                ? "#16a34a"
                                : seat.status === "booked"
                                ? "#ca8a04"
                                : "#334155";
                            return (
                              <span
                                key={seat.id}
                                className="seat-status-mini-badge"
                                style={{ background: bg, color: "#fff" }}
                                title={`${seat.seat_no}番席: ${seat.status} ${
                                  seat.game_name ? `(${seat.game_name})` : ""
                                }`}
                              >
                                {seat.seat_no}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <span
                          style={{
                            fontWeight: "bold",
                            color: bookedCount > 0 ? "#38bdf8" : "#64748b",
                          }}
                        >
                          {bookedCount} / {slot.seats.length}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            gap: "6px",
                            alignItems: "center",
                          }}
                        >
                          <button
                            type="button"
                            style={{
                              background: "#334155",
                              color: "#e2e8f0",
                              border: "1px solid #475569",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: "bold",
                              cursor: "pointer",
                            }}
                            onClick={() => handleShiftDelay(slot.id, 3)}
                            title="この枠以降を一括で+3分遅延シフト"
                          >
                            +3分遅延
                          </button>
                          <button
                            type="button"
                            style={{
                              background: slot.is_buffer ? "#8b5cf6" : "#1e293b",
                              color: "#fff",
                              border: "1px solid #64748b",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: "bold",
                              cursor: "pointer",
                            }}
                            onClick={() => handleToggleBuffer(slot.id)}
                            title="この枠を調整用空き枠/通常枠にトグル"
                          >
                            {slot.is_buffer ? "調整枠解除" : "調整枠化"}
                          </button>
                          <button
                            type="button"
                            style={{
                              background: slot.is_maintenance ? "#ca8a04" : "#1e293b",
                              color: "#fff",
                              border: "1px solid #eab308",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: "bold",
                              cursor: "pointer",
                            }}
                            onClick={() => handleToggleMaintenance(slot.id)}
                            title="この枠をメンテナンス枠（客割当停止）/通常枠にトグル"
                          >
                            {slot.is_maintenance ? "メンテ解除" : "メンテ枠化"}
                          </button>
                          <button
                            type="button"
                            style={{
                              background: "#2563eb",
                              color: "#fff",
                              border: "none",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              fontWeight: "bold",
                              cursor: "pointer",
                            }}
                            onClick={() => setQuickAdjust(slot)}
                            title="この枠を起点にして以降のスロットを再調整"
                          >
                            ここから再調整
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
