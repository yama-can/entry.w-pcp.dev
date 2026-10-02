import React, { useState, useEffect, useMemo, useRef } from "react";
import { SlotTimeline } from "../types";
import { ClockIcon, RefreshCwIcon } from "./Icons";
import { getLaneTheme } from "../utils/theme";

export interface ScheduleEvent {
  id: string;
  type: "entrance" | "exit";
  timeStr: string; // HH:mm:ss または HH:mm
  totalMinutes: number;
  totalSeconds: number; // 秒単位の総秒数
  slotId: number;
  lane: string;
  slotTime: string;
  playDuration: number;
  isClosed: boolean;
  assignedCount: number;
  seats: any[];
  isSyncedToEntrance?: boolean; // 入場完了時刻に合わせて秒単位で同期されたか
  syncedFromTime?: string;      // 同期元の入場完了時刻 (HH:mm:ss)
}

export interface CompletionTimestamp {
  timestamp: number;
  timeStr: string; // HH:mm:ss
  totalSeconds: number;
}

interface SchedulerTabProps {
  timeline: SlotTimeline[];
  handleShiftDelay: (fromSlotId: number, shiftMinutes: number) => void;
  fetchData: () => void;
}

export const SchedulerTab: React.FC<SchedulerTabProps> = ({
  timeline,
  handleShiftDelay,
  fetchData,
}) => {
  // 現在時刻状態（1秒更新）
  const [now, setNow] = useState<Date>(new Date());
  const [selectedLane, setSelectedLane] = useState<string>("all");
  // 仮想時刻シミュレーション（nullなら実時刻）
  const [simulatedTime, setSimulatedTime] = useState<string | null>(null);
  // 自動スクロール追従フラグ
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  // 現在フォーカスしているイベントのインデックス
  const [focusedEventIndex, setFocusedEventIndex] = useState<number>(0);
  const [customShiftMinutes, setCustomShiftMinutes] = useState("");

  // ★ 手動「完了」タスクのステート管理（localStorage永続化）
  const [completedTaskIds, setCompletedTaskIds] = useState<{ [id: string]: boolean }>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("scheduler_completed_tasks");
        return saved ? JSON.parse(saved) : {};
      } catch {}
    }
    return {};
  });

  // ★ 完了時の正確なタイムスタンプ（秒単位）
  const [completedTaskTimestamps, setCompletedTaskTimestamps] = useState<{ [id: string]: CompletionTimestamp }>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("scheduler_completed_timestamps");
        return saved ? JSON.parse(saved) : {};
      } catch {}
    }
    return {};
  });

  const eventCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 現在の「HH:mm:ss」および「分（0:00からの総分数）」を算出
  const currentTotalSeconds = useMemo(() => {
    if (simulatedTime) {
      const [h, m] = simulatedTime.split(":").map(Number);
      return h * 3600 + m * 60 + (now.getSeconds() % 60);
    }
    return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }, [now, simulatedTime]);

  const currentTotalMinutes = Math.floor(currentTotalSeconds / 60);

  const currentTimeDisplay = useMemo(() => {
    if (simulatedTime) {
      const s = String(now.getSeconds()).padStart(2, "0");
      return `${simulatedTime}:${s}`;
    }
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [now, simulatedTime]);

  // 手動完了の切り替え（秒単位タイムスタンプ付き）
  const toggleTaskCompleted = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const willBeCompleted = !completedTaskIds[id];

    setCompletedTaskIds((prev) => {
      const next = { ...prev, [id]: willBeCompleted };
      try {
        localStorage.setItem("scheduler_completed_tasks", JSON.stringify(next));
      } catch {}
      return next;
    });

    setCompletedTaskTimestamps((prev) => {
      const next = { ...prev };
      if (willBeCompleted) {
        // 現在の秒単位時刻を記録
        const recordSeconds = currentTotalSeconds;
        const h = Math.floor(recordSeconds / 3600) % 24;
        const m = Math.floor((recordSeconds % 3600) / 60);
        const s = recordSeconds % 60;
        const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        next[id] = {
          timestamp: Date.now(),
          timeStr,
          totalSeconds: recordSeconds,
        };
      } else {
        delete next[id];
      }
      try {
        localStorage.setItem("scheduler_completed_timestamps", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // 全タスクの完了リセット
  const handleResetAllCompleted = () => {
    if (confirm("すべてのタスクの完了マークおよび秒同期をリセットしますか？")) {
      setCompletedTaskIds({});
      setCompletedTaskTimestamps({});
      try {
        localStorage.removeItem("scheduler_completed_tasks");
        localStorage.removeItem("scheduler_completed_timestamps");
      } catch {}
    }
  };

  // タイムラインから「入場案内」と「退場案内」の2つのタスクを生成
  // ★ 入場案内が完了した場合、退場案内の時刻を秒単位で連動同期！
  const scheduleEvents = useMemo(() => {
    const events: ScheduleEvent[] = [];

    for (const slot of timeline) {
      const [h, m] = slot.slot_time.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) continue;

      const slotStartMinutes = h * 60 + m;
      const slotStartSeconds = slotStartMinutes * 60;
      const playDur = slot.play_duration || 5;

      const assignedSeats = slot.seats.filter(
        (s) => s.is_assigned || s.status === "checked_in"
      );

      // 1. 入場案内タスク
      const entranceCompletedRecord = completedTaskTimestamps[`entrance-${slot.id}`];
      events.push({
        id: `entrance-${slot.id}`,
        type: "entrance",
        timeStr: entranceCompletedRecord ? entranceCompletedRecord.timeStr : `${slot.slot_time}:00`,
        totalMinutes: slotStartMinutes,
        totalSeconds: entranceCompletedRecord ? entranceCompletedRecord.totalSeconds : slotStartSeconds,
        slotId: slot.id,
        lane: slot.lane,
        slotTime: slot.slot_time,
        playDuration: playDur,
        isClosed: slot.is_closed,
        assignedCount: assignedSeats.length,
        seats: slot.seats,
      });

      // 2. 退場案内タスク
      // ★ 入場完了ボタンが押されている場合、実際の完了秒数から playDuration 分後を退場時刻とする！
      let exitTotalSeconds: number;
      let exitTimeStr: string;
      let isSyncedToEntrance = false;
      let syncedFromTime: string | undefined = undefined;

      if (entranceCompletedRecord) {
        isSyncedToEntrance = true;
        syncedFromTime = entranceCompletedRecord.timeStr;
        exitTotalSeconds = entranceCompletedRecord.totalSeconds + playDur * 60;
        const eH = Math.floor(exitTotalSeconds / 3600) % 24;
        const eM = Math.floor((exitTotalSeconds % 3600) / 60);
        const eS = exitTotalSeconds % 60;
        exitTimeStr = `${String(eH).padStart(2, "0")}:${String(eM).padStart(2, "0")}:${String(eS).padStart(2, "0")}`;
      } else {
        const scheduledExitMinutes = slotStartMinutes + playDur;
        exitTotalSeconds = scheduledExitMinutes * 60;
        const eH = Math.floor(scheduledExitMinutes / 60) % 24;
        const eM = scheduledExitMinutes % 60;
        exitTimeStr = `${String(eH).padStart(2, "0")}:${String(eM).padStart(2, "0")}:00`;
      }

      events.push({
        id: `exit-${slot.id}`,
        type: "exit",
        timeStr: exitTimeStr,
        totalMinutes: Math.floor(exitTotalSeconds / 60),
        totalSeconds: exitTotalSeconds,
        slotId: slot.id,
        lane: slot.lane,
        slotTime: slot.slot_time,
        playDuration: playDur,
        isClosed: slot.is_closed,
        assignedCount: assignedSeats.length,
        seats: slot.seats,
        isSyncedToEntrance,
        syncedFromTime,
      });
    }

    return events.sort((a, b) => a.totalSeconds - b.totalSeconds);
  }, [timeline, completedTaskTimestamps]);

  // レーン絞り込み
  const filteredEvents = useMemo(() => {
    if (selectedLane === "all") return scheduleEvents;
    return scheduleEvents.filter((ev) => ev.lane === selectedLane);
  }, [scheduleEvents, selectedLane]);

  // 直近の案内イベント（入場または退場、かつ未完了を優先）
  const nextEvent = useMemo(() => {
    // 1. 未完了かつ現在の時刻以降のイベント
    const uncompletedFuture = scheduleEvents.find(
      (ev) => !completedTaskIds[ev.id] && ev.totalSeconds >= currentTotalSeconds - 30
    );
    if (uncompletedFuture) return uncompletedFuture;

    // 2. なければ単純に現在時刻以降のイベント
    return scheduleEvents.find((ev) => ev.totalSeconds >= currentTotalSeconds);
  }, [scheduleEvents, currentTotalSeconds, completedTaskIds]);

  // 直近イベントまでの秒数
  const secondsToNext = nextEvent ? nextEvent.totalSeconds - currentTotalSeconds : null;

  // 最も近いイベントのインデックス（未完了を優先してフォーカス）
  const closestIndex = useMemo(() => {
    if (filteredEvents.length === 0) return -1;
    // 未完了かつ現在以降
    const uncompletedIdx = filteredEvents.findIndex(
      (ev) => !completedTaskIds[ev.id] && ev.totalSeconds >= currentTotalSeconds - 30
    );
    if (uncompletedIdx !== -1) return uncompletedIdx;

    // 通常の現在時刻以降
    const idx = filteredEvents.findIndex((ev) => ev.totalSeconds >= currentTotalSeconds);
    return idx !== -1 ? idx : filteredEvents.length - 1;
  }, [filteredEvents, currentTotalSeconds, completedTaskIds]);

  // 現在進行中（または直近に案内すべき）の未完了先頭スロット
  const currentOpenSlot = useMemo(() => {
    return timeline.find((s) => !s.is_closed) || null;
  }, [timeline]);

  // 予定遅れ（ディレイ時間）の自動推定（現在時刻 vs 先頭未完了スロットの開始時刻）
  const delayMinutes = useMemo(() => {
    if (!currentOpenSlot) return 0;
    const [h, m] = currentOpenSlot.slot_time.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return 0;
    const slotMin = h * 60 + m;
    return currentTotalMinutes - slotMin; // 正なら遅延（押し）、負なら前倒し（巻き）
  }, [currentOpenSlot, currentTotalMinutes]);

  // レーン一覧
  const lanes = Array.from(new Set(timeline.map((s) => s.lane).filter(Boolean)));
  if (lanes.length === 0) lanes.push("A", "B");

  // クイック遅延シフト実行
  const triggerShift = (shiftMinutes: number) => {
    if (!currentOpenSlot) {
      alert("調整対象となる進行中のスロットがありません");
      return;
    }
    handleShiftDelay(currentOpenSlot.id, shiftMinutes);
  };

  // 指定イベントへのスクロール
  const scrollToEventId = (id: string) => {
    const el = eventCardRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // 直近の予定へジャンプ
  const handleJumpToClosest = () => {
    if (closestIndex >= 0 && closestIndex < filteredEvents.length) {
      setFocusedEventIndex(closestIndex);
      scrollToEventId(filteredEvents[closestIndex].id);
    }
  };

  // 前後の予定へスクロールで進める
  const handleScrollStep = (delta: number) => {
    const nextIdx = Math.max(0, Math.min(filteredEvents.length - 1, focusedEventIndex + delta));
    setFocusedEventIndex(nextIdx);
    if (filteredEvents[nextIdx]) {
      scrollToEventId(filteredEvents[nextIdx].id);
    }
  };

  // 初期ロード時・レーン切替時に直近予定へスクロール
  useEffect(() => {
    if (autoFollow && closestIndex >= 0 && filteredEvents[closestIndex]) {
      setFocusedEventIndex(closestIndex);
      const timer = setTimeout(() => {
        scrollToEventId(filteredEvents[closestIndex].id);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [selectedLane, closestIndex, autoFollow]);

  const completedCount = Object.values(completedTaskIds).filter(Boolean).length;

  return (
    <div className="scheduler-split-layout">
      {/* =========================================================
          【左側カラム】 特大時刻スクリーン ＆ 予定遅れ（ディレイ）管理
      ========================================================= */}
      <div className="scheduler-sticky-left">
        {/* ① デジタル時刻スクリーンカード */}
        <div
          className="card"
          style={{
            border: "1px solid var(--border-medium)",
            padding: "16px 20px",
            textAlign: "center",
          }}
        >
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
              <ClockIcon size={18} color="#38bdf8" />
              <span style={{ fontSize: "0.95rem", fontWeight: "700", color: "var(--text-main)" }}>
                進行時刻モニター
              </span>
            </div>

            <button
              className="btn-secondary"
              onClick={fetchData}
              style={{ padding: "4px 8px", fontSize: "0.76rem" }}
              title="データを最新化"
            >
              <RefreshCwIcon size={12} />
              <span>更新</span>
            </button>
          </div>

          {/* 特大デジタル時計 */}
          <div
            className="tabular font-mono"
            style={{
              fontSize: "clamp(2.8rem, 4.5vw, 4.2rem)",
              fontWeight: "800",
              color: "#f8fafc",
              letterSpacing: "-0.02em",
              lineHeight: "1.1",
              margin: "6px 0",
            }}
          >
            {currentTimeDisplay}
          </div>

          {/* 予定遅れ（ディレイ・押し）インジケーター */}
          <div style={{ marginTop: "10px" }}>
            {currentOpenSlot ? (
              delayMinutes > 1 ? (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    borderRadius: "var(--radius-md)",
                    padding: "8px 12px",
                    color: "#fca5a5",
                    fontSize: "0.92rem",
                    fontWeight: "700",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <span>遅れ進行</span>
                    <span className="tabular font-mono" style={{ fontSize: "1.1rem", color: "#f87171" }}>
                      +{delayMinutes}分
                    </span>
                  </div>
                  <span className="tabular" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    (先頭枠: {currentOpenSlot.lane}組 {currentOpenSlot.slot_time})
                  </span>
                </div>
              ) : delayMinutes < -1 ? (
                <div
                  style={{
                    background: "rgba(59, 130, 246, 0.1)",
                    border: "1px solid rgba(59, 130, 246, 0.4)",
                    borderRadius: "var(--radius-md)",
                    padding: "8px 12px",
                    color: "#93c5fd",
                    fontSize: "0.92rem",
                    fontWeight: "700",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                    <span>前倒し進行</span>
                    <span className="tabular font-mono" style={{ fontSize: "1.1rem", color: "#60a5fa" }}>
                      {delayMinutes}分
                    </span>
                  </div>
                  <span className="tabular" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    (先頭枠: {currentOpenSlot.lane}組 {currentOpenSlot.slot_time})
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    background: "rgba(16, 185, 129, 0.1)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: "var(--radius-md)",
                    padding: "8px 12px",
                    color: "#34d399",
                    fontSize: "0.92rem",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>予定通り進行中</span>
                  <span className="tabular" style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    ({currentOpenSlot.lane}組 {currentOpenSlot.slot_time})
                  </span>
                </div>
              )
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                全スロットが完了済みです
              </div>
            )}
          </div>

          {/* 直近イベントのカウントダウンバナー */}
          {nextEvent && secondsToNext !== null && (
            <div style={{ marginTop: "12px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: nextEvent.type === "exit" ? "rgba(239, 68, 68, 0.12)" : "rgba(34, 197, 94, 0.12)",
                  border: `1px solid ${nextEvent.type === "exit" ? "#ef4444" : "#22c55e"}`,
                  borderRadius: "8px",
                  padding: "8px 14px",
                  fontSize: "0.92rem",
                  fontWeight: "bold",
                  color: "#f8fafc",
                }}
              >
                <span>
                  {nextEvent.type === "entrance" ? "次回入場" : "次回退場"}:
                  <strong style={{ color: getLaneTheme(nextEvent.lane).color, marginLeft: "4px" }}>
                    {nextEvent.lane}組 {nextEvent.slotTime}
                  </strong>
                </span>
                <span style={{ color: "#38bdf8", fontWeight: "900" }}>
                  {nextEvent.timeStr} (残 {Math.floor(Math.max(0, secondsToNext) / 60)}分{Math.max(0, secondsToNext) % 60}秒)
                </span>
              </div>
            </div>
          )}

          {/* 仮想時刻シミュレーション */}
          <div
            style={{
              marginTop: "14px",
              paddingTop: "10px",
              borderTop: "1px solid #334155",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.8rem",
            }}
          >
            <span style={{ color: simulatedTime ? "#facc15" : "#64748b" }}>
              {simulatedTime ? "仮想時刻" : "実時刻連動"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="time"
                style={{
                  background: "#1e293b",
                  color: "#f8fafc",
                  border: "1px solid #475569",
                  borderRadius: "4px",
                  padding: "2px 6px",
                  fontSize: "0.8rem",
                }}
                value={simulatedTime || ""}
                onChange={(e) => setSimulatedTime(e.target.value || null)}
                title="時刻をシミュレーション指定"
              />
              {simulatedTime && (
                <button
                  type="button"
                  onClick={() => setSimulatedTime(null)}
                  style={{
                    background: "#334155",
                    color: "#cbd5e1",
                    border: "none",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  解除
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ② 予定遅れ（ディレイ）クイック調整カード */}
        <div
          className="card"
          style={{
            borderLeft: "4px solid #f59e0b",
            background: "#1e293b",
            padding: "16px 20px",
          }}
        >
          <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#facc15", marginBottom: "4px" }}>
            ⏱️ 予定遅れ（進行ディレイ）のクイック調整
          </div>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "12px" }}>
            入れ替え等の遅れ発生時、ボタン1つで以降の全スケジュール時刻を一括シフトします。
          </div>

          {currentOpenSlot ? (
            <div>
              <div style={{ fontSize: "0.8rem", color: "#cbd5e1", marginBottom: "8px" }}>
                【{currentOpenSlot.lane}組 {currentOpenSlot.slot_time}枠】以降を一括シフト:
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => triggerShift(-1)}
                  style={{
                    background: "#334155",
                    color: "#cbd5e1",
                    border: "1px solid #475569",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                  title="1分前倒し"
                >
                  -1分 短縮
                </button>
                <button
                  type="button"
                  onClick={() => triggerShift(-3)}
                  style={{
                    background: "#334155",
                    color: "#cbd5e1",
                    border: "1px solid #475569",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                  title="3分前倒し"
                >
                  -3分 短縮
                </button>
                <button
                  type="button"
                  onClick={() => triggerShift(1)}
                  style={{
                    background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
                    color: "#ffffff",
                    border: "none",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    fontWeight: "900",
                    cursor: "pointer",
                  }}
                  title="+1分後ろへシフト"
                >
                  +1分 遅延
                </button>
                <button
                  type="button"
                  onClick={() => triggerShift(2)}
                  style={{
                    background: "linear-gradient(135deg, #d97706 0%, #b45309 100%)",
                    color: "#ffffff",
                    border: "none",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    fontSize: "0.82rem",
                    fontWeight: "900",
                    cursor: "pointer",
                  }}
                  title="+2分後ろへシフト"
                >
                  +2分 遅延
                </button>
                <button
                  type="button"
                  onClick={() => triggerShift(3)}
                  style={{
                    background: "linear-gradient(135deg, #ea580c 0%, #c2410c 100%)",
                    color: "#ffffff",
                    border: "none",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: "900",
                    cursor: "pointer",
                  }}
                  title="+3分後ろへシフト"
                >
                  +3分 遅延
                </button>
                <button
                  type="button"
                  onClick={() => triggerShift(5)}
                  style={{
                    background: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
                    color: "#ffffff",
                    border: "none",
                    padding: "6px 8px",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                    fontWeight: "900",
                    cursor: "pointer",
                  }}
                  title="+5分後ろへシフト"
                >
                  +5分 遅延
                </button>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = Number(customShiftMinutes);
                  if (!Number.isInteger(value) || value === 0) {
                    alert("0以外の整数で入力してください");
                    return;
                  }
                  triggerShift(value);
                  setCustomShiftMinutes("");
                }}
                style={{
                  display: "flex",
                  alignItems: "end",
                  gap: "8px",
                  marginTop: "10px",
                }}
              >
                <label style={{ flex: 1, fontSize: "0.78rem", color: "#cbd5e1" }}>
                  任意のディレイ（分）
                  <input
                    type="number"
                    step={1}
                    value={customShiftMinutes}
                    onChange={(event) => setCustomShiftMinutes(event.target.value)}
                    placeholder="例: 8 / -2"
                    className="form-input tabular font-mono"
                    style={{ marginTop: "4px" }}
                  />
                </label>
                <button
                  type="submit"
                  style={{
                    background: "#475569",
                    color: "#fff",
                    border: "1px solid #64748b",
                    padding: "8px 14px",
                    borderRadius: "6px",
                    fontWeight: "700",
                    cursor: "pointer",
                  }}
                >
                  適用
                </button>
              </form>
            </div>
          ) : (
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>調整可能な枠がありません</div>
          )}
        </div>
      </div>

      {/* =========================================================
          【右側カラム】 予定タイムライン ＆ 近い予定のスクロール進捗
      ========================================================= */}
      <div className="card" style={{ padding: "18px 20px" }}>
        {/* ヘッダー＆スクロール操作バー */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "14px",
            flexWrap: "wrap",
            gap: "10px",
            paddingBottom: "12px",
            borderBottom: "1px solid #334155",
          }}
        >
          <div>
            <h3 style={{ fontSize: "1.15rem", fontWeight: "bold", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>タイムライン</span>
              <span style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: "normal" }}>
                ({filteredEvents.length}件 / 完了: {completedCount}件)
              </span>
            </h3>
          </div>

          {/* スクロールで進める操作ボタン群 ＆ 完了操作 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleJumpToClosest}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                color: "#ffffff",
                border: "none",
                padding: "6px 14px",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: "900",
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(2, 132, 199, 0.4)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              title="直近の未完了予定へ移動"
            >
              直近へ
            </button>

            <div style={{ display: "flex", gap: "4px" }}>
              <button
                type="button"
                onClick={() => handleScrollStep(-1)}
                style={{
                  background: "#334155",
                  color: "#cbd5e1",
                  border: "1px solid #475569",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "0.82rem",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
                title="1つ前の予定へスクロール"
              >
                ⬆️ 前へ
              </button>
              <button
                type="button"
                onClick={() => handleScrollStep(1)}
                style={{
                  background: "#334155",
                  color: "#cbd5e1",
                  border: "1px solid #475569",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  fontSize: "0.82rem",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
                title="1つ次の予定へスクロール"
              >
                ⬇️ 次へ
              </button>
            </div>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "0.78rem",
                color: "#94a3b8",
                cursor: "pointer",
                marginLeft: "4px",
              }}
            >
              <input
                type="checkbox"
                checked={autoFollow}
                onChange={(e) => setAutoFollow(e.target.checked)}
              />
              自動追従
            </label>

            {completedCount > 0 && (
              <button
                type="button"
                onClick={handleResetAllCompleted}
                style={{
                  background: "transparent",
                  color: "#64748b",
                  border: "none",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                  marginLeft: "4px",
                }}
                title="手動完了および秒単位同期をすべて解除"
              >
                完了リセット
              </button>
            )}
          </div>
        </div>

        {/* レーンフィルター */}
        <div style={{ display: "flex", gap: "6px", marginBottom: "14px", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: "#94a3b8", marginRight: "4px" }}>絞り込み:</span>
          <button
            type="button"
            onClick={() => setSelectedLane("all")}
            style={{
              padding: "4px 10px",
              borderRadius: "4px",
              fontSize: "0.8rem",
              fontWeight: "bold",
              border: "none",
              cursor: "pointer",
              background: selectedLane === "all" ? "#38bdf8" : "#1e293b",
              color: selectedLane === "all" ? "#0f172a" : "#cbd5e1",
            }}
          >
            全レーン
          </button>
          {lanes.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setSelectedLane(l)}
              style={{
                padding: "4px 10px",
                borderRadius: "4px",
                fontSize: "0.8rem",
                fontWeight: "bold",
                border: "none",
                cursor: "pointer",
                background: selectedLane === l ? getLaneTheme(l).color : "#1e293b",
                color: "#ffffff",
              }}
            >
              {l}組
            </button>
          ))}
        </div>

        {/* タイムラインリスト（縦スクロールで次々進める独立領域） */}
        {filteredEvents.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
            表示するタスクがありません。「設定」タブからスロットを生成してください。
          </div>
        ) : (
          <div ref={scrollContainerRef} className="scheduler-events-scroll">
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {filteredEvents.map((ev, index) => {
                const theme = getLaneTheme(ev.lane);
                const diffSeconds = ev.totalSeconds - currentTotalSeconds;
                const isCompleted = !!completedTaskIds[ev.id];
                const isNow = !isCompleted && diffSeconds <= 0 && diffSeconds >= -30;
                const isNext = !isCompleted && diffSeconds > 0 && diffSeconds <= 180; // 3分以内
                const isPast = !isCompleted && diffSeconds < -30;
                const isClosest = index === closestIndex;

                const remainingM = Math.floor(Math.abs(diffSeconds) / 60);
                const remainingS = Math.abs(diffSeconds) % 60;

                return (
                  <div
                    key={ev.id}
                    ref={(el) => {
                      if (el) eventCardRefs.current.set(ev.id, el);
                      else eventCardRefs.current.delete(ev.id);
                    }}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "12px 18px",
                      borderRadius: "8px",
                      background: isCompleted
                        ? "rgba(15, 23, 42, 0.45)"
                        : isNow
                        ? "rgba(56, 189, 248, 0.16)"
                        : isClosest && !isPast
                        ? "rgba(250, 204, 21, 0.1)"
                        : isPast
                        ? "rgba(15, 23, 42, 0.35)"
                        : "#1e293b",
                      border: `2px solid ${
                        isCompleted
                          ? "#1e3a8a"
                          : isNow
                          ? "#38bdf8"
                          : isClosest && !isPast
                          ? "#facc15"
                          : isNext
                          ? "#eab308"
                          : isPast
                          ? "#334155"
                          : "#475569"
                      }`,
                      boxShadow: isNow
                        ? "0 0 16px rgba(56, 189, 248, 0.35)"
                        : isClosest && !isPast
                        ? "0 0 12px rgba(250, 204, 21, 0.25)"
                        : "none",
                      opacity: isCompleted ? 0.65 : isPast ? 0.75 : 1,
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      {/* 時刻表示（秒単位まで表示） */}
                      <div
                        style={{
                          fontFamily: "monospace",
                          fontSize: "1.35rem",
                          fontWeight: "900",
                          color: isCompleted
                            ? "#64748b"
                            : isNow
                            ? "#38bdf8"
                            : isClosest
                            ? "#fef08a"
                            : isPast
                            ? "#94a3b8"
                            : "#f8fafc",
                          width: "90px",
                          textDecoration: isCompleted ? "line-through" : "none",
                        }}
                      >
                        {ev.timeStr}
                      </div>

                      {/* レーンバッジ */}
                      <span
                        className={theme.badgeClass}
                        style={{
                          backgroundColor: theme.color,
                          fontSize: "0.85rem",
                          padding: "3px 10px",
                          opacity: isCompleted ? 0.6 : 1,
                        }}
                      >
                        {ev.lane}組
                      </span>

                      {/* タスク名 ＆ 秒単位同期バッジ */}
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span
                            style={{
                              fontSize: "1.12rem",
                              fontWeight: "900",
                              color: isCompleted
                                ? "#94a3b8"
                                : ev.type === "entrance"
                                ? "#86efac"
                                : "#fca5a5",
                              textDecoration: isCompleted ? "line-through" : "none",
                            }}
                          >
                            {ev.type === "entrance" ? "入場" : "退場"}
                          </span>
                          <span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                            ({ev.slotTime}枠 / {ev.assignedCount}名)
                          </span>
                          {ev.isSyncedToEntrance && (
                            <span
                              style={{
                                fontSize: "0.72rem",
                                background: "rgba(56, 189, 248, 0.15)",
                                color: "#38bdf8",
                                border: "1px solid #0284c7",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                fontWeight: "bold",
                              }}
                              title={`入場完了時刻 (${ev.syncedFromTime}) より ${ev.playDuration}分後で連動`}
                            >
                              連動 (+{ev.playDuration}分)
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "0.8rem", color: isCompleted ? "#64748b" : "#cbd5e1", marginTop: "2px" }}>
                          {ev.type === "entrance"
                            ? "座席への案内完了時に「完了」を押してください"
                            : ev.isSyncedToEntrance
                            ? `入場完了 (${ev.syncedFromTime}) 連動: ${ev.timeStr} 退場`
                            : "ゲーム終了後に退場案内を行ってください"}
                        </div>
                      </div>
                    </div>

                    {/* 右側ステータス ＆ 手動完了アクションボタン */}
                    <div>
                      {isCompleted ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              background: "rgba(34, 197, 94, 0.15)",
                              color: "#86efac",
                              border: "1px solid #22c55e",
                              padding: "4px 12px",
                              borderRadius: "9999px",
                              fontWeight: "bold",
                              fontSize: "0.82rem",
                            }}
                          >
                            完了 ({completedTaskTimestamps[ev.id]?.timeStr || "済"})
                          </span>
                          <button
                            type="button"
                            onClick={(e) => toggleTaskCompleted(ev.id, e)}
                            style={{
                              background: "transparent",
                              color: "#94a3b8",
                              border: "1px solid #475569",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              cursor: "pointer",
                            }}
                            title="完了を取り消して未完了に戻します"
                          >
                            元に戻す
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          {/* 自動判定ステータスラベル */}
                          {isNow ? (
                            <span
                              style={{
                                background: "#ef4444",
                                color: "#fff",
                                padding: "5px 12px",
                                borderRadius: "9999px",
                                fontWeight: "900",
                                fontSize: "0.82rem",
                                boxShadow: "0 0 12px rgba(239, 68, 68, 0.6)",
                              }}
                            >
                              進行中
                            </span>
                          ) : isClosest && !isPast ? (
                            <span
                              style={{
                                background: "#0284c7",
                                color: "#fff",
                                padding: "5px 10px",
                                borderRadius: "9999px",
                                fontWeight: "900",
                                fontSize: "0.8rem",
                                boxShadow: "0 0 10px rgba(2, 132, 199, 0.5)",
                              }}
                            >
                              直前 (残{remainingM}分{remainingS}秒)
                            </span>
                          ) : isNext ? (
                            <span
                              style={{
                                background: "#ca8a04",
                                color: "#000",
                                padding: "4px 10px",
                                borderRadius: "9999px",
                                fontWeight: "bold",
                                fontSize: "0.8rem",
                              }}
                            >
                              次回 (残{remainingM}分{remainingS}秒)
                            </span>
                          ) : isPast ? (
                            <span style={{ color: "#64748b", fontSize: "0.8rem" }}>
                              経過 ({remainingM}分前)
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                              待機 (残{remainingM}分)
                            </span>
                          )}

                          {/* スタッフ用【完了】ボタン */}
                          <button
                            type="button"
                            onClick={(e) => toggleTaskCompleted(ev.id, e)}
                            style={{
                              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                              color: "#ffffff",
                              border: "none",
                              padding: "6px 14px",
                              borderRadius: "6px",
                              fontWeight: "900",
                              fontSize: "0.82rem",
                              cursor: "pointer",
                              boxShadow: "0 2px 6px rgba(16, 185, 129, 0.4)",
                              whiteSpace: "nowrap",
                            }}
                            title="案内完了時に押してください"
                          >
                            完了
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
