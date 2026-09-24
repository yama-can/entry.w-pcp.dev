/**
 * APIベースURLとレーン別テーマ定義ヘルパー
 */

export const getApiBase = (): string => {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname || "localhost";
    return `http://${hostname}:4000`;
  }
  return "http://localhost:4000";
};

export interface LaneTheme {
  color: string;
  bg: string;
  border: string;
  headerBg: string;
  badgeClass: string;
  ticketClass: string;
  label: string;
}

export const getLaneTheme = (lane: string): LaneTheme => {
  const l = (lane || "A").trim().toUpperCase();
  switch (l) {
    case "A":
      return {
        color: "#dc2626",
        bg: "rgba(220, 38, 38, 0.15)",
        border: "#ef4444",
        headerBg: "#7f1d1d",
        badgeClass: "badge-lane-a",
        ticketClass: "big-ticket-lane-a",
        label: "A組（赤レーン）",
      };
    case "B":
      return {
        color: "#2563eb",
        bg: "rgba(37, 99, 235, 0.15)",
        border: "#3b82f6",
        headerBg: "#1e3a8a",
        badgeClass: "badge-lane-b",
        ticketClass: "big-ticket-lane-b",
        label: "B組（青レーン）",
      };
    case "C":
      return {
        color: "#16a34a",
        bg: "rgba(22, 163, 74, 0.15)",
        border: "#22c55e",
        headerBg: "#14532d",
        badgeClass: "badge-lane-c",
        ticketClass: "big-ticket-lane-b",
        label: "C組（緑レーン）",
      };
    case "D":
      return {
        color: "#d97706",
        bg: "rgba(217, 119, 6, 0.15)",
        border: "#f59e0b",
        headerBg: "#78350f",
        badgeClass: "badge-lane-d",
        ticketClass: "big-ticket-lane-b",
        label: "D組（黄/橙レーン）",
      };
    case "E":
      return {
        color: "#9333ea",
        bg: "rgba(147, 51, 234, 0.15)",
        border: "#a855f7",
        headerBg: "#581c87",
        badgeClass: "badge-lane-e",
        ticketClass: "big-ticket-lane-b",
        label: "E組（紫レーン）",
      };
    default:
      return {
        color: "#0891b2",
        bg: "rgba(8, 145, 178, 0.15)",
        border: "#06b6d4",
        headerBg: "#164e63",
        badgeClass: "badge-lane-other",
        ticketClass: "big-ticket-lane-b",
        label: `${l}組`,
      };
  }
};

