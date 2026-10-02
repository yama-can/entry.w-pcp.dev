import React from "react";
import { GamepadIcon } from "./Icons";

export type TabType = "kiosk" | "checkin" | "assignment" | "inroom" | "monitor" | "scheduler" | "admin";

interface NavigationTabsProps {
  activeDay: number;
  handleSwitchDay: (day: number) => void;
  sseConnected: boolean;
}

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  activeDay,
  handleSwitchDay,
  sseConnected,
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

      </div>
    </header>
  );
};
