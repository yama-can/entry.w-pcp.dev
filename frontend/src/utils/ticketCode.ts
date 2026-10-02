export function getTicketDisplayCode(ticketNumber: number | null | undefined, priorityLevel = 0) {
  if (ticketNumber == null) return "";
  const number = String(ticketNumber).padStart(3, "0");
  if (priorityLevel === 2) return `I${number}`;
  if (priorityLevel === 1) return `P${number}`;
  return number;
}
