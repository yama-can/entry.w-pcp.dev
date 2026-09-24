import assert from 'node:assert';

const API_BASE = 'http://127.0.0.1:4000';

async function runTest() {
  console.log('--- 0. Generating fresh slots for test (10 slots, 6 seats each) ---');
  await fetch(`${API_BASE}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 10, seatsPerSlot: 6, startHour: 10, startMinute: 0 }),
  });

  console.log('--- 1. Testing Ticket Issuance (No frame/lane/seat pre-assigned) ---');
  // Issue ticket for Game ACT_01
  const issueRes1 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'ACT_01' }),
  });
  const issueData1 = await issueRes1.json();
  console.log('Issued Ticket 1:', issueData1);
  assert(issueData1.success, 'Ticket 1 issue should succeed');
  assert(typeof issueData1.ticket.ticket_number === 'number', 'ticket_number must be a number');
  assert.strictEqual(issueData1.ticket.game_id, 'ACT_01');
  const t1Num = issueData1.ticket.ticket_number;

  // Issue ticket for Game PUZ_01
  const issueRes2 = await fetch(`${API_BASE}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'PUZ_01' }),
  });
  const issueData2 = await issueRes2.json();
  console.log('Issued Ticket 2:', issueData2);
  assert(issueData2.success, 'Ticket 2 issue should succeed');
  const t2Num = issueData2.ticket.ticket_number;
  assert.strictEqual(t2Num, t1Num + 1, 'Ticket numbers must be sequential');

  console.log('--- 2. Testing Checkin List Endpoint ---');
  const checkinListRes = await fetch(`${API_BASE}/api/checkin/list`);
  const checkinListData = await checkinListRes.json();
  console.log(`Checkin list has ${checkinListData.tickets.length} tickets`);
  assert(checkinListData.success);
  const foundT1 = checkinListData.tickets.find(t => t.ticket_number === t1Num);
  const foundT2 = checkinListData.tickets.find(t => t.ticket_number === t2Num);
  assert(foundT1, 'Ticket 1 must be in checkin list');
  assert(foundT2, 'Ticket 2 must be in checkin list');
  assert.strictEqual(foundT1.status, 'issued', 'Ticket 1 initial status should be issued');

  console.log('--- 3. Testing Checkin Mark (到着・未到着) ---');
  // Mark T1 as arrived ('checked_in')
  const markRes1 = await fetch(`${API_BASE}/api/checkin/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t1Num, status: 'checked_in' }),
  });
  const markData1 = await markRes1.json();
  console.log('Mark T1 arrived:', markData1);
  assert(markData1.success);
  assert.strictEqual(markData1.status, 'checked_in');

  // Mark T2 as arrived using by-ticket endpoint
  const scanRes2 = await fetch(`${API_BASE}/api/checkin/by-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketNumber: t2Num }),
  });
  const scanData2 = await scanRes2.json();
  console.log('Scan T2 arrived:', scanData2);
  assert(scanData2.success);
  assert.strictEqual(scanData2.status, 'checked_in');

  console.log('--- 4. Testing Assignment Status & Planned Seats ---');
  const assignStatusRes = await fetch(`${API_BASE}/api/assignment/status`);
  const assignStatusData = await assignStatusRes.json();
  console.log(`Assignment status slots count: ${assignStatusData.slots.length}`);
  assert(assignStatusData.success);
  const firstOpenSlot = assignStatusData.slots.find(s => !s.is_closed);
  assert(firstOpenSlot, 'Should find an open slot');
  console.log(`First open slot [${firstOpenSlot.lane}組 ${firstOpenSlot.slot_time}] planned seats:`, firstOpenSlot.plannedSeats);
  assert(firstOpenSlot.plannedSeats.length >= 2, 'Should have at least 2 planned seats');
  assert(firstOpenSlot.plannedSeats.some(p => p.ticketNumber === t1Num), `Should contain ticket ${t1Num}`);
  assert(firstOpenSlot.plannedSeats.some(p => p.ticketNumber === t2Num), `Should contain ticket ${t2Num}`);

  console.log('--- 5. Testing Fill Slot (枠に割当) ---');
  const fillRes = await fetch(`${API_BASE}/api/assignment/fill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: firstOpenSlot.id }),
  });
  const fillData = await fillRes.json();
  console.log('Fill slot result:', fillData);
  assert(fillData.success);

  console.log('--- 6. Testing Seat Status for In-Room Monitor ---');
  const seatStatusRes1 = await fetch(`${API_BASE}/api/seat-status?lane=${firstOpenSlot.lane}&seat=1`);
  const seatStatusData1 = await seatStatusRes1.json();
  console.log('Seat 1 status:', seatStatusData1);
  assert(seatStatusData1.success);
  assert(seatStatusData1.hasReservation);
  assert(typeof seatStatusData1.ticket_number === 'number');
  assert.strictEqual(seatStatusData1.ticket_code, `No. ${seatStatusData1.ticket_number}`);
  assert.strictEqual(seatStatusData1.game_name, '爆走バトルレーシング');
  assert.strictEqual(seatStatusData1.game_command, 'racing.exe');

  console.log('--- 7. Testing Unfill Slot (割当解除) ---');
  const unfillRes = await fetch(`${API_BASE}/api/assignment/unfill-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slotId: firstOpenSlot.id }),
  });
  const unfillData = await unfillRes.json();
  console.log('Unfill slot result:', unfillData);
  assert(unfillData.success);

  // Check that tickets are back to checked_in
  const checkinListResAfter = await fetch(`${API_BASE}/api/checkin/list`);
  const checkinListDataAfter = await checkinListResAfter.json();
  const t1After = checkinListDataAfter.tickets.find(t => t.ticket_number === t1Num);
  assert.strictEqual(t1After.status, 'checked_in', 'Ticket should revert to checked_in');

  console.log('\nAll numbered ticket workflow backend tests PASSED successfully!');
}

runTest().catch((err) => {
  console.error('Test FAILED:', err);
  process.exit(1);
});
