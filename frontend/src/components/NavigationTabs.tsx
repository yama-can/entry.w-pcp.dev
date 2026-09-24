import React from "react";
import {
  GamepadIcon,
  TicketIcon,
  CheckCircleIcon,
  ClockIcon,
  MonitorIcon,
  SettingsIcon,
} from "./Icons";

export type TabType = "kiosk" | "checkin" | "assignment" | "inroom" | "scheduler" | "admin";

interface NavigationTabsProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  activeDay: number;
  handleSwitchDay: (day: number) => void;
  sseConnected: boolean;
  countTicketsUnarrived: number;
  unassignedCheckedInCount: number;
  lateQueueCount?: number;
}

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  activeTab,
  setActiveTab,
  activeDay,
  handleSwitchDay,
  sseConnected,
  countTicketsUnarrived,
  unassignedCheckedInCount,
}) => {
  return (
    <header className="app-header">
      <div className="header-inner">
        {/* 上段（モバイル・PC共通バー） */}
        <div className="header-top-bar">
          <div className="header-brand">
            <h1 className="header-title">
              <GamepadIcon size={20} color="#38bdf8" />
              <span>整理券管理</span>
            </h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Day 1 / Day 2 切替 */}
            <div className="day-selector-group" role="tablist">
              <button
                type="button"
                className={`day-btn ${activeDay === 1 ? "active" : ""}`}
                onClick={() => handleSwitchDay(1)}
              >
                Day 1
              </button>
              <button
                type="button"
                className={`day-btn ${activeDay === 2 ? "active" : ""}`}
                onClick={() => handleSwitchDay(2)}
              >
                Day 2
              </button>
            </div>

            {/* 同期ステータス */}
            <span
              className={`status-pill ${sseConnected ? "online" : "offline"}`}
              title={sseConnected ? "リアルタイムLAN同期接続中" : "オフライン"}
            >
              <span className="status-dot" />
              <span>{sseConnected ? "同期中" : "オフライン"}</span>
            </span>
          </div>
        </div>

        {/* 下段（横スクロール対応チップ型ナビゲーション） */}
        <div className="nav-tabs-container">
          <nav className="nav-tabs" role="tablist">
            <button
              type="button"
              className={`nav-tab-btn ${activeTab === "kiosk" ? "active" : ""}`}
              onClick={() => setActiveTab("kiosk")}
            >
              <TicketIcon size={15} />
              <span>発券</span>
            </button>

            <button
              type="button"
              className={`nav-tab-btn ${activeTab === "checkin" ? "active" : ""}`}
              onClick={() => setActiveTab("checkin")}
            >
              <CheckCircleIcon size={15} />
              <span>受付</span>
              {countTicketsUnarrived > 0 && (
                <span className="nav-badge nav-badge-danger">
                  {countTicketsUnarrived}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`nav-tab-btn ${activeTab === "assignment" ? "active" : ""}`}
              onClick={() => setActiveTab("assignment")}
            >
              <ClockIcon size={15} />
              <span>割当</span>
              {unassignedCheckedInCount > 0 && (
                <span className="nav-badge nav-badge-warning">
                  {unassignedCheckedInCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className={`nav-tab-btn ${activeTab === "inroom" ? "active" : ""}`}
              onClick={() => setActiveTab("inroom")}
            >
              <MonitorIcon size={15} />
              <span>モニター</span>
            </button>

            <button
              type="button"
              className={`nav-tab-btn ${activeTab === "scheduler" ? "active" : ""}`}
              onClick={() => setActiveTab("scheduler")}
            >
              <ClockIcon size={15} />
              <span>進行</span>
            </button>

            <button
              type="button"
              className={`nav-tab-btn ${activeTab === "admin" ? "active" : ""}`}
              onClick={() => setActiveTab("admin")}
            >
              <SettingsIcon size={15} />
              <span>設定</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
};
