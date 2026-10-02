import React from "react";
import { SlotTimeline, SeatReservation } from "@/types";
import { getLaneTheme } from "@/utils/theme";

interface CallingMonitorTabProps {
  activeDay: number;
  dynamicLanes: string[];
  timeline: SlotTimeline[];
}

function ticketCode(seat: SeatReservation): string {
  if (seat.display_ticket_code) return seat.display_ticket_code;
  if (!seat.ticket_number) return "";
  const number = String(seat.display_number ?? seat.ticket_number).padStart(3, "0");
  if (seat.priority_level === 2) return `I${number}`;
  if (seat.priority_level === 1) return `P${number}`;
  return `No. ${number}`;
}

export const CallingMonitorTab: React.FC<CallingMonitorTabProps> = ({
  activeDay,
  dynamicLanes,
  timeline,
}) => {
  const closedSlots = timeline
    .filter((slot) => slot.is_closed && !slot.is_maintenance)
    .sort((a, b) => b.order_idx - a.order_idx);
  const currentSlots = dynamicLanes
    .map((lane) => closedSlots.find((slot) => slot.lane === lane))
    .filter((slot): slot is SlotTimeline => Boolean(slot));

  return (
    <main
      style={{
        minHeight: "calc(100vh - 80px)",
        background: "#020617",
        color: "#f8fafc",
        padding: "clamp(20px, 5vw, 64px)",
      }}
    >
      <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(28px, 6vw, 64px)" }}>
          <div style={{ color: "#38bdf8", fontSize: "clamp(0.9rem, 2vw, 1.2rem)", fontWeight: 800, letterSpacing: "0.18em" }}>
            DAY {activeDay}
          </div>
          <h1 style={{ margin: "12px 0 0", fontSize: "clamp(2rem, 6vw, 4.8rem)", lineHeight: 1.05 }}>
            呼び出し案内
          </h1>
          <p style={{ margin: "16px 0 0", color: "#94a3b8", fontSize: "clamp(0.95rem, 2vw, 1.25rem)" }}>
            表示された整理券の方は、レーン前へお越しください
          </p>
        </div>

        {currentSlots.length === 0 ? (
          <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "clamp(1.2rem, 3vw, 2rem)", padding: "80px 20px" }}>
            現在、呼び出しはありません
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(currentSlots.length, 3)}, minmax(0, 1fr))`, gap: "clamp(16px, 3vw, 36px)" }}>
            {currentSlots.map((slot) => {
              const theme = getLaneTheme(slot.lane);
              const seats = slot.seats.filter((seat) => seat.status !== "empty" && ticketCode(seat));
              return (
                <section key={slot.id} style={{ borderTop: `8px solid ${theme.color}`, background: "#0f172a", borderRadius: "16px", padding: "clamp(18px, 3vw, 36px)", boxShadow: "0 16px 40px rgba(0,0,0,.3)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px", marginBottom: "24px" }}>
                    <strong style={{ fontSize: "clamp(1.4rem, 3vw, 2.2rem)" }}>{slot.lane}組</strong>
                    <span style={{ color: "#cbd5e1", fontSize: "clamp(1.2rem, 3vw, 2rem)", fontWeight: 800 }}>{slot.slot_time}</span>
                  </div>
                  {seats.length === 0 ? (
                    <div style={{ color: "#64748b", fontSize: "1.2rem", textAlign: "center", padding: "20px 0" }}>呼び出しなし</div>
                  ) : (
                    <div style={{ display: "grid", gap: "14px" }}>
                      {seats.map((seat) => (
                        <div key={seat.id} style={{ background: "#1e293b", borderRadius: "12px", padding: "18px 16px", textAlign: "center" }}>
                          <div style={{ color: theme.color, fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1, fontWeight: 900, fontFamily: "ui-monospace, monospace" }}>
                            {ticketCode(seat)}
                          </div>
                          <div style={{ color: "#cbd5e1", fontSize: "clamp(1rem, 2vw, 1.35rem)", marginTop: "12px" }}>
                            {seat.seat_no}番席へお越しください
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
};
