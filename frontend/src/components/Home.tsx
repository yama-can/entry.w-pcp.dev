"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type {
  Game,
  SlotTimeline,
  IssuedTicket,
  LateQueueItem,
  WaitStatus,
  AssignmentSlotStatus,
  TicketItem,
  SeatReservation,
  BufferSummary,
} from "@/types";
import { AlertCircleIcon, CheckCircleIcon } from "@/components/Icons";
import { getApiBase } from "@/utils/theme";
import { getTicketDisplayCode } from "@/utils/ticketCode";
import { NavigationTabs, TabType } from "@/components/NavigationTabs";
import { KioskTab } from "@/components/KioskTab";
import { CheckinTab } from "@/components/CheckinTab";
import { AssignmentTab } from "@/components/AssignmentTab";
import { InRoomMonitorTab } from "@/components/InRoomMonitorTab";
import { CallingMonitorTab } from "@/components/CallingMonitorTab";
import { SchedulerTab } from "@/components/SchedulerTab";
import { AdminTab } from "@/components/AdminTab";
import { ReassignModal, ReassignSource } from "@/components/ReassignModal";

interface HomeProps { activeTab: TabType; }

export default function Home({ activeTab }: HomeProps) {

  const [activeDay, setActiveDay] = useState<number>(1);
  const [games, setGames] = useState<Game[]>([]);
  const [timeline, setTimeline] = useState<SlotTimeline[]>([]);
  const [checkinTickets, setCheckinTickets] = useState<TicketItem[]>([]);
  const [assignmentSlots, setAssignmentSlots] = useState<AssignmentSlotStatus[]>([]);
  const [unassignedCheckedInCount, setUnassignedCheckedInCount] = useState<number>(0);
  const [bufferSummary, setBufferSummary] = useState<BufferSummary | null>(null);
  const [lateQueue, setLateQueue] = useState<LateQueueItem[]>([]);
  const [lastIssued, setLastIssued] = useState<IssuedTicket | null>(null);
  const [pendingCheckinTicket, setPendingCheckinTicket] = useState<IssuedTicket | null>(null);
  const [scanInput, setScanInput] = useState("");
  const [ticketScanInput, setTicketScanInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  // 待ち時間・発券制限状態
  const [waitStatus, setWaitStatus] = useState<WaitStatus | null>(null);
  const [maxWaitLimitInput, setMaxWaitLimitInput] = useState<string>("30");

  // 管理者フォーム用状態
  const [genMode, setGenMode] = useState<"all" | "from_slot" | "append">("all");
  const [targetDay, setTargetDay] = useState<number>(1);
  const [selectedFromSlotId, setSelectedFromSlotId] = useState<string>("");
  const [startHour, setStartHour] = useState("09");
  const [startMinute, setStartMinute] = useState("00");
  const [endHour, setEndHour] = useState("16");
  const [endMinute, setEndMinute] = useState("00");
  const [slotCount, setSlotCount] = useState("60");
  const [seatsPerSlot, setSeatsPerSlot] = useState("4");
  const [lanesInput, setLanesInput] = useState("A, B");
  const [laneSeatCountsInput, setLaneSeatCountsInput] = useState("A:4, B:5");
  const [playDuration, setPlayDuration] = useState("5");
  const [cleanupDuration, setCleanupDuration] = useState("2");
  const [laneOffset, setLaneOffset] = useState("3");
  const [bufferInterval, setBufferInterval] = useState("4");
  const [bufferDuration, setBufferDuration] = useState("3");
  const [priorityGameId, setPriorityGameId] = useState("");
  const [meetingLeadMinutes, setMeetingLeadMinutes] = useState(7);
  const [meetingLeadInput, setMeetingLeadInput] = useState("7");
  const [newGameId, setNewGameId] = useState("");
  const [newGameName, setNewGameName] = useState("");
  const [newGameCmd, setNewGameCmd] = useState("");

  // 室内準備モニター用スロット選択マップ (レーン名 -> スロットID)
  const [selectedClosedSlotMap, setSelectedClosedSlotMap] = useState<Record<string, string>>({});

  // 検索用ステート
  const [attendanceSearch, setAttendanceSearch] = useState("");
  const [reassignModalSource, setReassignModalSource] = useState<ReassignSource | null>(null);

  // 管理者認証状態
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState<boolean>(false);

  const scanInputRef = useRef<HTMLInputElement>(null);
  const ticketInputRef = useRef<HTMLInputElement>(null);
  const adminFormRef = useRef<HTMLDivElement>(null);

  const API_BASE = getApiBase();

  // 管理者トークン検証（初回マウント時）
  useEffect(() => {
    const savedToken = typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
    if (savedToken) {
      setAdminToken(savedToken);
      fetch(`${API_BASE}/api/admin/verify`, {
        headers: { "X-Admin-Token": savedToken },
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.valid) {
            setIsAdminLoggedIn(true);
          } else {
            localStorage.removeItem("admin_token");
            setAdminToken(null);
            setIsAdminLoggedIn(false);
          }
        })
        .catch(() => {
          setIsAdminLoggedIn(false);
        });
    }
  }, [API_BASE]);

  // 管理者ログイン処理
  const handleAdminLogin = async (password: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem("admin_token", data.token);
        setAdminToken(data.token);
        setIsAdminLoggedIn(true);
        setSuccessMessage("管理者ログイン完了");
        return true;
      } else {
        setErrorMessage(data.message || "パスワードが正しくありません");
        return false;
      }
    } catch {
      setErrorMessage("ログイン通信に失敗しました");
      return false;
    }
  };

  // 管理者ログアウト処理
  const handleAdminLogout = async () => {
    if (adminToken) {
      try {
        await fetch(`${API_BASE}/api/admin/logout`, {
          method: "POST",
          headers: { "X-Admin-Token": adminToken },
        });
      } catch {}
    }
    localStorage.removeItem("admin_token");
    setAdminToken(null);
    setIsAdminLoggedIn(false);
    setSuccessMessage("ログアウト完了");
  };

  // 管理者専用APIリクエスト共通ラッパー
  const adminFetch = async (endpoint: string, body?: any) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (adminToken) {
      headers["X-Admin-Token"] = adminToken;
    }
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      localStorage.removeItem("admin_token");
      setAdminToken(null);
      setIsAdminLoggedIn(false);
      setErrorMessage("管理者認証が必要です。ログインしてください。");
      throw new Error("UNAUTHORIZED");
    }
    return res.json();
  };

  // 1枠あたりの平均ピッチ計算
  const getAvgSlotDur = (
    pDur: string = playDuration,
    cDur: string = cleanupDuration,
    lns: string = lanesInput
  ) => {
    const play = parseInt(pDur, 10) || 5;
    const clean = parseInt(cDur, 10) || 2;
    const countLanes = Math.max(1, lns.split(",").map((s) => s.trim()).filter(Boolean).length);
    return (play + clean) / countLanes;
  };

  const updateCountFromTime = (
    sh: string,
    sm: string,
    eh: string,
    em: string,
    pDur: string = playDuration,
    cDur: string = cleanupDuration,
    lns: string = lanesInput
  ) => {
    const sH = parseInt(sh, 10);
    const sM = parseInt(sm, 10);
    const eH = parseInt(eh, 10);
    const eM = parseInt(em, 10);
    const avg = getAvgSlotDur(pDur, cDur, lns);
    if (!isNaN(sH) && !isNaN(sM) && !isNaN(eH) && !isNaN(eM) && avg > 0) {
      const sTot = sH * 60 + sM;
      const eTot = eH * 60 + eM;
      if (eTot > sTot) {
        const c = Math.floor((eTot - sTot) / avg);
        setSlotCount(String(c));
      }
    }
  };

  const updateEndFromCount = (
    sh: string,
    sm: string,
    cnt: string,
    pDur: string = playDuration,
    cDur: string = cleanupDuration,
    lns: string = lanesInput
  ) => {
    const sH = parseInt(sh, 10);
    const sM = parseInt(sm, 10);
    const c = parseInt(cnt, 10);
    const avg = getAvgSlotDur(pDur, cDur, lns);
    if (!isNaN(sH) && !isNaN(sM) && !isNaN(c) && c > 0 && avg > 0) {
      const eTot = Math.round(sH * 60 + sM + c * avg) % 1440;
      const eh = Math.floor(eTot / 60);
      const em = eTot % 60;
      setEndHour(String(eh).padStart(2, "0"));
      setEndMinute(String(em).padStart(2, "0"));
    }
  };

  // データ取得
  const fetchData = useCallback(async () => {
    try {
      const [gamesRes, timelineRes, lateRes, dayRes, assignRes, checkinRes] = await Promise.all([
        fetch(`${API_BASE}/api/games`).then((r) => r.json()),
        fetch(`${API_BASE}/api/timeline`).then((r) => r.json()),
        fetch(`${API_BASE}/api/late-queue`).then((r) => r.json()),
        fetch(`${API_BASE}/api/day/current`).then((r) => r.json()),
        fetch(`${API_BASE}/api/assignment/status`).then((r) => r.json()).catch(() => ({ success: false })),
        fetch(`${API_BASE}/api/checkin/list`).then((r) => r.json()).catch(() => ({ success: false })),
      ]);
      if (gamesRes.success) setGames(gamesRes.games);
      if (dayRes.success) {
        setActiveDay(dayRes.activeDay);
        setTargetDay(dayRes.activeDay);
      }
      if (timelineRes.success) {
        setTimeline(timelineRes.timeline);
        if (timelineRes.timeline.length > 0 && !selectedFromSlotId) {
          setSelectedFromSlotId(String(timelineRes.timeline[0].id));
        }
        if (timelineRes.waitStatus) {
          setWaitStatus(timelineRes.waitStatus);
          setMaxWaitLimitInput(String(timelineRes.waitStatus.maxWaitMinutes));
        }
      }
      if (lateRes.success) setLateQueue(lateRes.list);
      if (assignRes && assignRes.success) {
        setAssignmentSlots(assignRes.slots || []);
        setUnassignedCheckedInCount(assignRes.totalUnassignedCheckedIn || 0);
        if (assignRes.meetingLeadMinutes !== undefined) {
          setMeetingLeadMinutes(assignRes.meetingLeadMinutes);
          setMeetingLeadInput(String(assignRes.meetingLeadMinutes));
        }
        if (assignRes.bufferSummary) {
          setBufferSummary(assignRes.bufferSummary);
        }
      }
      if (checkinRes && checkinRes.success) {
        setCheckinTickets(checkinRes.tickets || []);
        if (checkinRes.bufferSummary) {
          setBufferSummary(checkinRes.bufferSummary);
        }
      }
    } catch (err) {
      console.error("データ取得エラー:", err);
    }
  }, [API_BASE, selectedFromSlotId]);

  // 枠確定ハンドラー
  const handleFillSlot = async (slotId: number, slotTime: string, lane: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message || `${lane}組 ${slotTime} 割当完了`);
        fetchData();
      } else {
        setErrorMessage(data.message || "枠の割当に失敗しました");
      }
    } catch {
      setErrorMessage("枠の割当通信に失敗しました");
    }
  };

  // 枠の割当解除ハンドラー
  const handleUnfillSlot = async (slotId: number, slotTime: string, lane: string) => {
    if (!confirm(`${lane}組 ${slotTime} の割当を解除しますか？`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/assignment/unfill-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message || "割当解除完了");
        fetchData();
      } else {
        setErrorMessage(data.message || "割当解除に失敗しました");
      }
    } catch {
      setErrorMessage("割当解除の通信に失敗しました");
    }
  };

  // SSEリアルタイム同期
  useEffect(() => {
    fetchData();

    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connectSSE = () => {
      try {
        eventSource = new EventSource(`${API_BASE}/api/events`);

        eventSource.onopen = () => {
          setSseConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "update" || data.type === "connected" || data.reason === "day_switched") {
              fetchData();
            }
          } catch {}
        };

        eventSource.onerror = () => {
          setSseConnected(false);
          eventSource?.close();
          reconnectTimeout = setTimeout(connectSSE, 2000);
        };
      } catch (err) {
        console.error("SSE接続失敗:", err);
        reconnectTimeout = setTimeout(connectSSE, 3000);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [API_BASE, fetchData]);

  // フォーカス維持
  useEffect(() => {
    if (activeTab === "kiosk") {
      scanInputRef.current?.focus();
    } else if (activeTab === "checkin") {
      ticketInputRef.current?.focus();
    }
  }, [activeTab]);

  // 日程切替（Day 1 ⇄ Day 2）
  const handleSwitchDay = async (day: number) => {
    try {
      const data = await adminFetch('/api/day/switch', { day });
      if (data.success) {
        setActiveDay(day);
        setTargetDay(day);
        setLastIssued(null);
        setSuccessMessage(`Day ${day} に切替完了`);
      } else {
        setErrorMessage(data.message || "日程切替に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("日程切替に失敗しました");
      }
    }
  };

  // 発券時の即時チェックイン（CheckinTabと同様のAPI・レスポンス処理）
  const handleImmediateCheckin = async () => {
    const ticket = pendingCheckinTicket;
    if (!ticket) return;
    const ticketIdentifier = ticket.display_ticket_code || ticket.ticket_code || String(ticket.ticket_number);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/checkin/by-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: ticket.id, ticketNumber: ticketIdentifier }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.message || "チェックインに失敗しました");
        return;
      }
      setPendingCheckinTicket(null);
      if (lastIssued && (lastIssued.id === ticket.id || lastIssued.ticket_number === ticket.ticket_number)) {
        setLastIssued({ ...lastIssued, status: data.status || "checked_in" });
      }
      setSuccessMessage(data.message || `${data.ticketCode || String(data.ticketNumber).padStart(3, "0")} のステータスを更新しました`);
      fetchData();
    } catch {
      setErrorMessage("サーバーと通信できませんでした");
    }
  };

  const handleIssueTicket = async (gameId: string) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId: gameId.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.code === "WAIT_LIMIT_EXCEEDED" || data.reason === "WAIT_LIMIT_EXCEEDED") {
          setErrorMessage(
            `待ち時間超過（約${data.currentWaitMinutes}分）：発券停止中（再開目安: ${data.resumeTime}頃）`
          );
        } else {
          setErrorMessage(data.message || "発券に失敗しました");
        }
        return;
      }
      setLastIssued(data.ticket);
      setPendingCheckinTicket(data.ticket);
      setSuccessMessage(
        `${data.ticket.display_ticket_code || String(data.ticket.ticket_number).padStart(3, "0")} (${data.ticket.game_name}) 発券完了`
        + (data.ticket.meeting_time ? ` ／ 集合時間 ${data.ticket.meeting_time}` : "")
      );
      setScanInput("");
      scanInputRef.current?.focus();
      fetchData();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "サーバーと通信できませんでした");
    }
  };

  const handleIssuePriorityTicket = async (priorityLevel: 1 | 2) => {
    try {
      const data = await adminFetch('/api/admin/issue-priority', {
        gameId: priorityGameId,
        priorityLevel,
        day: activeDay,
      });
      if (data.success) {
        setLastIssued(data.ticket);
        setPendingCheckinTicket(data.ticket);
        setSuccessMessage(
          `${data.ticket.display_ticket_code} を${priorityLevel === 2 ? "即時" : "優先"}チケットとして発行しました`
          + (data.ticket.meeting_time ? ` ／ 集合時間 ${data.ticket.meeting_time}` : "")
        );
        setPriorityGameId("");
        fetchData();
      } else {
        setErrorMessage(data.message || "優先チケットの発行に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage(err instanceof Error ? err.message : "優先チケット発行の通信に失敗しました");
      }
    }
  };

  // 最大許容待ち時間制限の更新
  const handleUpdateMaxWait = async (minutes: number) => {
    try {
      const data = await adminFetch('/api/settings/max-wait', { maxWaitMinutes: minutes });
      if (data.success) {
        setSuccessMessage(data.message);
      } else {
        setErrorMessage(data.message || "設定更新に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("設定更新の通信に失敗しました");
      }
    }
  };

  const handleSetIssuingPaused = async (paused: boolean) => {
    try {
      const data = await adminFetch('/api/settings/issuing-pause', { paused });
      if (data.success) {
        setSuccessMessage(data.message);
        fetchData();
      } else {
        setErrorMessage(data.message || "発券状態の更新に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("発券状態の更新通信に失敗しました");
      }
    }
  };

  // 集合時間リードタイム設定の更新
  const handleUpdateMeetingLead = async (minutes: number) => {
    try {
      const data = await adminFetch('/api/settings/meeting-lead', { meetingLeadMinutes: minutes });
      if (data.success) {
        setMeetingLeadMinutes(data.meetingLeadMinutes);
        setMeetingLeadInput(String(data.meetingLeadMinutes));
        setSuccessMessage(data.message);
        fetchData();
      } else {
        setErrorMessage(data.message || "集合時間設定の更新に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("集合時間設定の通信に失敗しました");
      }
    }
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanInput.trim()) return;
    handleIssueTicket(scanInput.trim());
  };

  // 整理番号QRスキャン / 入力によるチェックイン
  const handleTicketScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketScanInput.trim()) return;
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/checkin/by-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketNumber: ticketScanInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMessage(data.message || "チェックインに失敗しました");
        return;
      }
      setSuccessMessage(data.message || `${data.ticketCode || String(data.ticketNumber).padStart(3, "0")} のステータスを更新しました`);
      setTicketScanInput("");
      ticketInputRef.current?.focus();
      fetchData();
    } catch {
      setErrorMessage("サーバーと通信できませんでした");
    }
  };

  // 到着ステータス直接マーク（「到着」/「未到着に戻す」）
  const handleMarkTicket = async (
    target: TicketItem | { id?: number; ticket_number: number; display_number?: number; display_ticket_code?: string; priority_level?: number },
    status: "checked_in" | "issued"
  ) => {
    try {
      const res = await fetch(`${API_BASE}/api/checkin/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: target.id,
          ticketNumber: target.ticket_number,
          ticketCode: target.display_ticket_code,
          status,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message);
        fetchData();
      } else {
        setErrorMessage(data.message || "ステータス更新に失敗しました");
      }
    } catch {
      setErrorMessage("通信に失敗しました");
    }
  };

  // 整理券の取消
  const handleCancelTicket = async (
    target: TicketItem | { id?: number; ticket_number: number; display_number?: number; display_ticket_code?: string; priority_level?: number },
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    const code = target.display_ticket_code || getTicketDisplayCode(target.display_number ?? target.ticket_number, target.priority_level);
    if (!confirm(`整理番号 ${code} を取消（欠席扱い）にしますか？`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/checkin/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: target.id,
          ticketNumber: target.ticket_number,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message);
        fetchData();
      } else {
        setErrorMessage(data.message || "取消に失敗しました");
      }
    } catch {
      setErrorMessage("通信に失敗しました");
    }
  };

  // 欠席（個別キャンセル）
  const handleCancelReservation = async (reservationId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("この席を欠席扱いにして空席（再発券可能）へ戻しますか？")) return;
    try {
      await fetch(`${API_BASE}/api/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId }),
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // 遅刻保留者の再割り当て
  const handleReassignLate = async (lateId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/late-queue/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lateId }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(
          `${data.result.lane}組 ${data.result.slotTime} ${data.result.seatNo}席 (${data.result.ticketCode}) へ再案内完了`
        );
        fetchData();
      } else {
        setErrorMessage(data.message || "再割り当てに失敗しました");
      }
    } catch {
      setErrorMessage("通信エラーが発生しました");
    }
  };

  // 保留者のキャンセル
  const handleCancelLate = async (lateId: number) => {
    if (!confirm("この保留データをキャンセルしますか？")) return;
    try {
      await fetch(`${API_BASE}/api/late-queue/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lateId }),
      });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // レーンをまたいだ座席移動・割り当て
  const handleReassignSeat = async (
    sourceReservationId: number,
    targetSlotId: number,
    targetSeatNo: number
  ) => {
    try {
      const res = await fetch(`${API_BASE}/api/reservations/reassign-seat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceReservationId, targetSlotId, targetSeatNo }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(data.message);
        setReassignModalSource(null);
        fetchData();
      } else {
        setErrorMessage(data.message || "座席の割り当てに失敗しました");
      }
    } catch {
      setErrorMessage("座席割り当て通信に失敗しました");
    }
  };

  // スロット生成 / ある時点以降の調整ハンドラ
  const handleGenerateOrAdjustSlots = async (e: React.FormEvent) => {
    e.preventDefault();

    if (genMode === "all") {
      if (!confirm(`Day ${targetDay} のタイムテーブルを再生成しますか？`))
        return;

      try {
        const data = await adminFetch('/api/slots/generate', {
          day: targetDay,
          startHour: parseInt(startHour, 10),
          startMinute: parseInt(startMinute, 10),
          endHour: endHour ? parseInt(endHour, 10) : undefined,
          endMinute: endMinute ? parseInt(endMinute, 10) : undefined,
          count: slotCount ? parseInt(slotCount, 10) : undefined,
          seatsPerSlot: parseInt(seatsPerSlot, 10),
          lanes: lanesInput,
          laneSeatCounts: laneSeatCountsInput || undefined,
          playDuration: parseInt(playDuration, 10) || 5,
          cleanupDuration: parseInt(cleanupDuration, 10) || 2,
          laneOffset: laneOffset ? parseInt(laneOffset, 10) : undefined,
          bufferInterval: parseInt(bufferInterval, 10),
          bufferDuration: parseInt(bufferDuration, 10) || 3,
        });
        if (data.success) {
          setSuccessMessage(`Day ${targetDay} スロット一括生成 (${data.count}枠)`);
          fetchData();
        } else {
          setErrorMessage(data.message || "スロット生成に失敗しました");
        }
      } catch (err: any) {
        if (err.message !== "UNAUTHORIZED") {
          setErrorMessage("スロット生成に失敗しました");
        }
      }
    } else {
      const isAppend = genMode === "append";
      const targetSlot = timeline.find((s) => String(s.id) === selectedFromSlotId);
      const confirmText = isAppend
        ? `Day ${targetDay} 末尾にスロットを追加しますか？`
        : `Day ${targetDay} ${targetSlot?.lane}組 ${targetSlot?.slot_time} 以降を再生成しますか？`;

      if (!confirm(confirmText)) return;

      try {
        const data = await adminFetch('/api/slots/adjust-from', {
          day: targetDay,
          fromSlotId: isAppend ? null : parseInt(selectedFromSlotId, 10),
          startHour: startHour ? parseInt(startHour, 10) : undefined,
          startMinute: startMinute ? parseInt(startMinute, 10) : undefined,
          endHour: endHour ? parseInt(endHour, 10) : undefined,
          endMinute: endMinute ? parseInt(endMinute, 10) : undefined,
          count: slotCount ? parseInt(slotCount, 10) : undefined,
          seatsPerSlot: parseInt(seatsPerSlot, 10),
          lanes: lanesInput,
          laneSeatCounts: laneSeatCountsInput || undefined,
          playDuration: parseInt(playDuration, 10) || 5,
          cleanupDuration: parseInt(cleanupDuration, 10) || 2,
          laneOffset: laneOffset ? parseInt(laneOffset, 10) : undefined,
          bufferInterval: parseInt(bufferInterval, 10),
          bufferDuration: parseInt(bufferDuration, 10) || 3,
          appendOnly: isAppend,
        });
        if (data.success) {
          setSuccessMessage(data.message || "スロット調整完了");
          fetchData();
        } else {
          setErrorMessage(data.message || "スロット調整に失敗しました");
        }
      } catch (err: any) {
        if (err.message !== "UNAUTHORIZED") {
          setErrorMessage("スロット調整リクエストに失敗しました");
        }
      }
    }
  };

  // スロット個別更新ハンドラ
  const handleUpdateSlot = async (
    slotId: number,
    params: {
      durationMinutes?: number;
      playDuration?: number;
      cleanupDuration?: number;
      lane?: string;
    }
  ) => {
    try {
      const data = await adminFetch('/api/slots/update-slot', { slotId, ...params });
      if (data.success) {
        setSuccessMessage(data.message);
        fetchData();
      } else {
        setErrorMessage(data.message || "スロット設定の更新に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("スロット設定更新の通信に失敗しました");
      }
    }
  };

  // 遅延シフトハンドラ
  const handleShiftDelay = async (fromSlotId: number, shiftMinutes: number) => {
    const targetSlot = timeline.find((s) => s.id === fromSlotId);
    if (
      !confirm(
        `${targetSlot?.lane}組 ${targetSlot?.slot_time} 以降を ${
          shiftMinutes > 0 ? `+${shiftMinutes}` : shiftMinutes
        }分シフトしますか？`
      )
    ) {
      return;
    }

    try {
      const data = await adminFetch('/api/slots/shift-delay', { fromSlotId, shiftMinutes });
      if (data.success) {
        setSuccessMessage(data.message);
        fetchData();
      } else {
        setErrorMessage(data.message || "シフト処理に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("シフト処理に失敗しました");
      }
    }
  };

  // 調整枠切替ハンドラ
  const handleToggleBuffer = async (slotId: number) => {
    try {
      const data = await adminFetch('/api/slots/toggle-buffer', { slotId });
      if (data.success) {
        setSuccessMessage(`${data.is_buffer ? "調整枠" : "通常枠"}に切替完了`);
        fetchData();
      } else {
        setErrorMessage(data.message || "調整枠切替に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("調整枠切替に失敗しました");
      }
    }
  };

  // メンテナンス枠切替ハンドラ（客を一切入れない枠）
  const handleToggleMaintenance = async (slotId: number) => {
    try {
      const data = await adminFetch('/api/slots/toggle-maintenance', { slotId });
      if (data.success) {
        setSuccessMessage(`${data.is_maintenance ? "メンテナンス枠（割当停止）" : "通常枠"}に切替完了`);
        fetchData();
      } else {
        setErrorMessage(data.message || "メンテナンス枠切替に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("メンテナンス枠切替に失敗しました");
      }
    }
  };

  const handleToggleSeatMaintenance = async (reservationId: number) => {
    try {
      const data = await adminFetch('/api/slots/toggle-seat-maintenance', { reservationId });
      if (data.success) {
        setSuccessMessage(data.is_maintenance ? "座席をメンテナンス化しました" : "座席メンテナンスを解除しました");
        fetchData();
      } else {
        setErrorMessage(data.message || "座席メンテナンスの更新に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") setErrorMessage("座席メンテナンス更新の通信に失敗しました");
    }
  };

  const setQuickAdjust = (slot: SlotTimeline) => {
    setGenMode("from_slot");
    setSelectedFromSlotId(String(slot.id));
    const [h, m] = slot.slot_time.split(":");
    setStartHour(h);
    setStartMinute(m);
    updateEndFromCount(h, m, slotCount);
    adminFormRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // ゲームマスタ登録
  const handleSaveGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGameId.trim() || !newGameName.trim()) return;
    try {
      const data = await adminFetch('/api/games', {
        id: newGameId.trim(),
        name: newGameName.trim(),
        command: newGameCmd.trim(),
      });
      if (data.success) {
        setNewGameId("");
        setNewGameName("");
        setNewGameCmd("");
        setSuccessMessage("ゲーム保存完了");
        fetchData();
      } else {
        setErrorMessage(data.message || "ゲームの登録に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("ゲームの登録に失敗しました");
      }
    }
  };

  const handleDeleteGame = async (id: string) => {
    if (!confirm(`ゲーム [${id}] を削除しますか？`)) return;
    try {
      const data = await adminFetch('/api/games/delete', { id });
      if (data.success) {
        setSuccessMessage(data.message || "ゲーム削除完了");
        fetchData();
      } else {
        setErrorMessage(data.message || "ゲームの削除に失敗しました");
      }
    } catch (err: any) {
      if (err.message !== "UNAUTHORIZED") {
        setErrorMessage("ゲーム削除の通信に失敗しました");
      }
    }
  };

  // タイムラインのレーン一覧
  const dynamicLanes = Array.from(new Set(timeline.map((s) => s.lane).filter(Boolean)));
  if (dynamicLanes.length === 0) dynamicLanes.push("A", "B");

  // 全スロットの現在空き席リスト（再割り当てモーダル用）
  const availableEmptySeats = timeline
    .filter((slot) => !slot.is_closed)
    .flatMap((slot) =>
      slot.seats
        .filter((seat: SeatReservation) => seat.status === "empty")
        .map((seat: SeatReservation) => ({
          slot_id: slot.id,
          slot_time: slot.slot_time,
          lane: slot.lane,
          seat_no: seat.seat_no,
          is_buffer: slot.is_buffer,
        }))
    );

  return (
    <>
      <NavigationTabs
        activeDay={activeDay}
        handleSwitchDay={handleSwitchDay}
        sseConnected={sseConnected}
      />

      <main className="main-container">
        {/* エラーメッセージバー */}
        {errorMessage && (
          <div
            style={{
              background: "#991b1b",
              color: "#fecaca",
              padding: "12px 18px",
              borderRadius: "8px",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: "bold",
            }}
          >
            <AlertCircleIcon size={20} />
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "#fecaca",
                cursor: "pointer",
                fontSize: "1.2rem",
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* 成功メッセージバー */}
        {successMessage && (
          <div
            style={{
              background: "#065f46",
              color: "#a7f3d0",
              padding: "12px 18px",
              borderRadius: "8px",
              marginBottom: "16px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontWeight: "bold",
            }}
          >
            <CheckCircleIcon size={20} />
            <span>{successMessage}</span>
            <button
              onClick={() => setSuccessMessage(null)}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "#a7f3d0",
                cursor: "pointer",
                fontSize: "1.2rem",
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* ① 受付発券 */}
        {activeTab === "kiosk" && (
          <KioskTab
            waitStatus={waitStatus}
            activeDay={activeDay}
            scanInput={scanInput}
            setScanInput={setScanInput}
            handleScanSubmit={handleScanSubmit}
            scanInputRef={scanInputRef}
            games={games}
            handleIssueTicket={handleIssueTicket}
            lastIssued={lastIssued}
            pendingCheckinTicket={pendingCheckinTicket}
            handleImmediateCheckin={handleImmediateCheckin}
          />
        )}

        {/* ② 受付（チェックイン） - ★左右2カラム分割 */}
        {activeTab === "checkin" && (
          <CheckinTab
            checkinTickets={checkinTickets}
            ticketScanInput={ticketScanInput}
            setTicketScanInput={setTicketScanInput}
            handleTicketScanSubmit={handleTicketScanSubmit}
            ticketInputRef={ticketInputRef}
            attendanceSearch={attendanceSearch}
            setAttendanceSearch={setAttendanceSearch}
            handleMarkTicket={handleMarkTicket}
            handleCancelTicket={handleCancelTicket}
            fetchData={fetchData}
            bufferSummary={bufferSummary}
          />
        )}

        {/* ③ 枠割当管理 */}
        {activeTab === "assignment" && (
          <AssignmentTab
            unassignedCheckedInCount={unassignedCheckedInCount}
            fetchData={fetchData}
            assignmentSlots={assignmentSlots}
            handleFillSlot={handleFillSlot}
            handleUnfillSlot={handleUnfillSlot}
            setReassignModalSource={setReassignModalSource}
            handleCancelReservation={handleCancelReservation}
            bufferSummary={bufferSummary}
            handleToggleMaintenance={handleToggleMaintenance}
          />
        )}

        {/* ④ 室内準備モニター */}
        {activeTab === "inroom" && (
          <InRoomMonitorTab
            activeDay={activeDay}
            dynamicLanes={dynamicLanes}
            timeline={timeline}
            selectedClosedSlotMap={selectedClosedSlotMap}
            setSelectedClosedSlotMap={setSelectedClosedSlotMap}
          />
        )}
        {activeTab === "monitor" && (
          <CallingMonitorTab
            activeDay={activeDay}
            dynamicLanes={dynamicLanes}
            timeline={timeline}
          />
        )}

        {/* ⑤ スケジューラー（特大時刻スクリーン・予定遅れ管理・入場退場案内） */}
        {activeTab === "scheduler" && (
          <SchedulerTab
            timeline={timeline}
            handleShiftDelay={handleShiftDelay}
            fetchData={fetchData}
          />
        )}

        {/* ⑥ 設定・タイムテーブル */}
        {activeTab === "admin" && (
          <AdminTab
            adminFormRef={adminFormRef}
            targetDay={targetDay}
            setTargetDay={setTargetDay}
            genMode={genMode}
            setGenMode={setGenMode}
            selectedFromSlotId={selectedFromSlotId}
            setSelectedFromSlotId={setSelectedFromSlotId}
            startHour={startHour}
            setStartHour={setStartHour}
            startMinute={startMinute}
            setStartMinute={setStartMinute}
            endHour={endHour}
            setEndHour={setEndHour}
            endMinute={endMinute}
            setEndMinute={setEndMinute}
            slotCount={slotCount}
            setSlotCount={setSlotCount}
            seatsPerSlot={seatsPerSlot}
            setSeatsPerSlot={setSeatsPerSlot}
            lanesInput={lanesInput}
            setLanesInput={setLanesInput}
            laneSeatCountsInput={laneSeatCountsInput}
            setLaneSeatCountsInput={setLaneSeatCountsInput}
            playDuration={playDuration}
            setPlayDuration={setPlayDuration}
            cleanupDuration={cleanupDuration}
            setCleanupDuration={setCleanupDuration}
            laneOffset={laneOffset}
            setLaneOffset={setLaneOffset}
            bufferDuration={bufferDuration}
            setBufferDuration={setBufferDuration}
            bufferInterval={bufferInterval}
            setBufferInterval={setBufferInterval}
            updateCountFromTime={updateCountFromTime}
            updateEndFromCount={updateEndFromCount}
            getAvgSlotDur={getAvgSlotDur}
            handleGenerateOrAdjustSlots={handleGenerateOrAdjustSlots}
            waitStatus={waitStatus}
            maxWaitLimitInput={maxWaitLimitInput}
            setMaxWaitLimitInput={setMaxWaitLimitInput}
            handleUpdateMaxWait={handleUpdateMaxWait}
            handleSetIssuingPaused={handleSetIssuingPaused}
            priorityGameId={priorityGameId}
            setPriorityGameId={setPriorityGameId}
            handleIssuePriorityTicket={handleIssuePriorityTicket}
            meetingLeadInput={meetingLeadInput}
            setMeetingLeadInput={setMeetingLeadInput}
            handleUpdateMeetingLead={handleUpdateMeetingLead}
            newGameId={newGameId}
            setNewGameId={setNewGameId}
            newGameName={newGameName}
            setNewGameName={setNewGameName}
            newGameCmd={newGameCmd}
            setNewGameCmd={setNewGameCmd}
            handleSaveGame={handleSaveGame}
            handleDeleteGame={handleDeleteGame}
            games={games}
            timeline={timeline}
            activeDay={activeDay}
            dynamicLanes={dynamicLanes}
            handleUpdateSlot={handleUpdateSlot}
            handleShiftDelay={handleShiftDelay}
            handleToggleBuffer={handleToggleBuffer}
            handleToggleMaintenance={handleToggleMaintenance}
            handleToggleSeatMaintenance={handleToggleSeatMaintenance}
            setQuickAdjust={setQuickAdjust}
            isAdminLoggedIn={isAdminLoggedIn}
            onLogin={handleAdminLogin}
            onLogout={handleAdminLogout}
          />
        )}

        {/* 席移動モーダル */}
        {reassignModalSource && (
          <ReassignModal
            source={reassignModalSource}
            availableEmptySeats={availableEmptySeats}
            onClose={() => setReassignModalSource(null)}
            onReassign={handleReassignSeat}
          />
        )}
      </main>
    </>
  );
}
