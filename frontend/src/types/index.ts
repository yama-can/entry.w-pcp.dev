export interface Game {
  id: string;
  name: string;
  command?: string;
}

export type SeatStatus = 'empty' | 'booked' | 'checked_in' | 'finished';

export interface SeatReservation {
  id: number;
  seat_no: number;
  ticket_code: string;
  ticket_number?: number | null;
  display_number?: number | null;
  assigned_ticket_code?: string | null;
  display_ticket_code?: string | null;
  note?: string | null;
  status: SeatStatus;
  is_maintenance?: boolean;

  is_assigned?: boolean;
  game_id?: string | null;
  priority_level?: number;
  game_name?: string | null;
  game_command?: string | null;
  updated_at?: string;
}

export interface Slot {
  id: number;
  day_id?: number;
  order_idx: number;
  slot_time: string;
  lane: string;
  duration_minutes: number;
  play_duration?: number;
  cleanup_duration?: number;
  is_buffer: boolean;
  is_maintenance?: boolean;
  is_closed: boolean;
  meeting_time?: string;
  meeting_lead_minutes?: number;
  is_meeting_reached?: boolean;
  seats: SeatReservation[];
}

export interface IssuedTicket {
  id?: number;
  ticket_number: number;
  display_number?: number;
  ticket_code?: string;
  display_ticket_code?: string;
  game_id: string;
  game_name: string;
  priority_level?: number;
  waiting_count?: number;
  expected_slot_id?: number | null;
  expected_slot_time?: string | null;
  original_expected_slot_id?: number | null;
  original_expected_slot_time?: string | null;
  expected_lane?: string | null;
  meeting_time?: string | null;
  day_id?: number;
  created_at?: string;
  // compatibility fields
  reservation_id?: number;
  slot_time?: string;
  lane?: string;
  seat_no?: number;
}

export interface TicketItem {
  id: number;
  day_id: number;
  ticket_number: number;
  game_id: string;
  game_name: string;
  game_command?: string;
  priority_level?: number;
  status: 'issued' | 'checked_in' | 'assigned' | 'cancelled';
  assigned_slot_id?: number | null;
  assigned_seat_no?: number | null;
  expected_slot_id?: number | null;
  expected_slot_time?: string | null;
  original_expected_slot_id?: number | null;
  original_expected_slot_time?: string | null;
  expected_lane?: string | null;
  created_at: string;
  checked_in_at?: string | null;
  is_delayed?: boolean;
}

export interface LateQueueItem {
  id: number;
  original_ticket_code: string;
  original_slot_time: string;
  lane: string;
  seat_no: number;
  game_id?: string | null;
  game_name?: string | null;
  status: 'waiting' | 'reassigned' | 'cancelled';
  created_at: string;
}

export interface BumpedDetail {
  fromSlotTime: string;
  fromLane: string;
  fromTicketCode: string;
  toSlotTime: string;
  toLane: string;
  toSeatNo: number;
  toTicketCode: string;
  gameName?: string;
}

export interface CloseResult {
  slotId: number;
  slotTime: string;
  lane: string;
  lateCount: number;
  bumpedCount: number;
  bumpedList: BumpedDetail[];
}

export interface WaitStatus {
  canIssue: boolean;
  reason: 'NO_SLOTS' | 'FULL' | 'WAIT_LIMIT_EXCEEDED' | 'PAUSED' | 'OK' | string;
  message: string;
  maxWaitMinutes: number;
  currentWaitMinutes: number;
  nextSlotTime: string | null;
  resumeTime: string | null;
}

export interface PlannedSeat {
  seatNo: number;
  ticketId?: number;
  ticketNumber?: number;
  displayTicketNumber?: string;
  gameName: string;
  gameId?: string | null;
  reservationId?: number;
  ticketCode?: string;
  displayTicketCode?: string;
  fromLane?: string;
  fromSlotTime?: string;
  isPromoted?: boolean;
  expectedSlotId?: number | null;
  expectedSlotTime?: string | null;
  originalExpectedSlotId?: number | null;
  originalExpectedSlotTime?: string | null;
  assignmentType?: 'on_time' | 'delayed' | 'advanced' | 'buffer' | 'fill';
  priorityLevel?: number;
}

export interface AssignmentSlot extends Slot {
  plannedSeats: PlannedSeat[];
  canFill: boolean;
}

export interface BufferSummary {
  totalBufferSlots: number;
  totalBufferSeats: number;
  remainingBufferSlots: number;
  remainingBufferSeats: number;
  unassignedDelayedCount: number;
  unarrivedDelayedCount: number;
  seatsDiff: number;
  canAccommodate: boolean;
}

export type SlotTimeline = Slot;
export type AssignmentSlotStatus = AssignmentSlot;
