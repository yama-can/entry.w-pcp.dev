import React from "react";
import { getLaneTheme } from "../utils/theme";

export interface ReassignSource {
  reservationId: number;
  ticketCode: string;
  slotTime: string;
  lane: string;
  gameName: string;
}

export interface AvailableEmptySeat {
  slot_id: number;
  slot_time: string;
  lane: string;
  seat_no: number;
  is_buffer: boolean | number;
}

interface ReassignModalProps {
  source: ReassignSource;
  availableEmptySeats: AvailableEmptySeat[];
  onClose: () => void;
  onReassign: (reservationId: number, targetSlotId: number, targetSeatNo: number) => void;
}

export const ReassignModal: React.FC<ReassignModalProps> = ({
  source,
  availableEmptySeats,
  onClose,
  onReassign,
}) => {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          maxWidth: "560px",
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "#1e293b",
          border: "2px solid #38bdf8",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h3
            style={{
              fontSize: "1.1rem",
              fontWeight: "bold",
              color: "#38bdf8",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            座席移動
          </h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              fontSize: "1.2rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            background: "#0f172a",
            padding: "10px 12px",
            borderRadius: "8px",
            marginBottom: "14px",
            border: "1px solid #334155",
          }}
        >
          <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>対象:</div>
          <div
            style={{
              fontSize: "1rem",
              fontWeight: "bold",
              color: "#f8fafc",
              marginTop: "2px",
            }}
          >
            {source.lane}組 {source.slotTime} / <span style={{ color: "#38bdf8" }}>{source.ticketCode}</span>
          </div>
          <div style={{ fontSize: "0.85rem", color: "#86efac", marginTop: "2px" }}>
            希望: {source.gameName}
          </div>
        </div>

        <div style={{ marginBottom: "10px", fontSize: "0.88rem", fontWeight: "600", color: "#cbd5e1" }}>
          移動先を選択:
        </div>

        {availableEmptySeats.length === 0 ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              color: "#94a3b8",
              background: "#0f172a",
              borderRadius: "8px",
              fontSize: "0.88rem",
            }}
          >
            空席がありません
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px",
              maxHeight: "320px",
              overflowY: "auto",
            }}
          >
            {availableEmptySeats.slice(0, 16).map((emptySeat) => {
              const theme = getLaneTheme(emptySeat.lane);
              return (
                <button
                  key={`${emptySeat.slot_id}-${emptySeat.seat_no}`}
                  type="button"
                  onClick={() =>
                    onReassign(
                      source.reservationId,
                      emptySeat.slot_id,
                      emptySeat.seat_no
                    )
                  }
                  style={{
                    background: theme.bg,
                    border: `1px solid ${theme.border}`,
                    borderRadius: "6px",
                    padding: "10px",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "bold", fontSize: "1rem", color: "#f8fafc" }}>
                      {emptySeat.slot_time}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: theme.color, fontWeight: "600" }}>
                      {emptySeat.lane}組 {emptySeat.seat_no}席{" "}
                      {emptySeat.is_buffer ? "(調整枠)" : ""}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: "0.78rem",
                      background: theme.color,
                      color: "#fff",
                      padding: "3px 7px",
                      borderRadius: "4px",
                      fontWeight: "600",
                    }}
                  >
                    選択
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: "16px", textAlign: "right" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "#334155",
              color: "#f8fafc",
              border: "none",
              padding: "8px 16px",
              borderRadius: "6px",
              cursor: "pointer",
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};
