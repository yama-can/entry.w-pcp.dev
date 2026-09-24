async function runTests() {
  const baseUrl = 'http://127.0.0.1:4000';
  console.log('--- Starting API Tests ---');

  // 1. GET /api/games
  const gRes = await fetch(`${baseUrl}/api/games`).then(r => r.json());
  console.log('1. GET /api/games:', gRes.success && gRes.games.length > 0 ? 'PASS' : 'FAIL');

  // 2. POST /api/games
  const addGameRes = await fetch(`${baseUrl}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'TEST_01', name: 'テストゲーム', command: 'test.exe' }),
  }).then(r => r.json());
  console.log('2. POST /api/games:', addGameRes.success ? 'PASS' : 'FAIL');

  // 3. POST /api/slots/generate
  const genRes = await fetch(`${baseUrl}/api/slots/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startHour: 10, startMinute: 0, count: 4, seatsPerSlot: 6 }),
  }).then(r => r.json());
  console.log('3. POST /api/slots/generate:', genRes.success ? 'PASS' : 'FAIL');

  // 4. GET /api/timeline
  const tlRes = await fetch(`${baseUrl}/api/timeline`).then(r => r.json());
  const validTimeline = tlRes.success && tlRes.timeline.length === 4 &&
    tlRes.timeline[0].lane === 'A' && tlRes.timeline[0].slot_time === '10:00' &&
    tlRes.timeline[1].lane === 'B' && tlRes.timeline[1].slot_time === '10:03' &&
    tlRes.timeline[2].lane === 'A' && tlRes.timeline[2].slot_time === '10:06' &&
    tlRes.timeline[3].lane === 'B' && tlRes.timeline[3].slot_time === '10:09';
  console.log('4. GET /api/timeline (3分ピッチ・A/B交互・各6席):', validTimeline ? 'PASS' : 'FAIL');

  // 5. POST /api/issue (最若空席の自動マッチング)
  const issueRes = await fetch(`${baseUrl}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'TEST_01' }),
  }).then(r => r.json());
  const issuedOk = issueRes.success &&
    issueRes.ticket.lane === 'A' &&
    issueRes.ticket.slot_time === '10:00' &&
    issueRes.ticket.seat_no === 1 &&
    issueRes.ticket.ticket_code === 'A1000-1';
  console.log('5. POST /api/issue (最若空席 A1000-1 予約):', issuedOk ? 'PASS' : 'FAIL', issueRes.ticket);

  const reservationId = issueRes.ticket.reservation_id;
  const ticketCode = issueRes.ticket.ticket_code;

  // 6. POST /api/checkin/toggle (booked -> checked_in)
  const toggleRes1 = await fetch(`${baseUrl}/api/checkin/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId }),
  }).then(r => r.json());
  console.log('6-1. POST /api/checkin/toggle (to checked_in):', toggleRes1.status === 'checked_in' ? 'PASS' : 'FAIL');

  // booked に戻す
  const toggleRes2 = await fetch(`${baseUrl}/api/checkin/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId }),
  }).then(r => r.json());
  console.log('6-2. POST /api/checkin/toggle (to booked):', toggleRes2.status === 'booked' ? 'PASS' : 'FAIL');

  // 7. POST /api/checkin/by-ticket (QR/バーコードスキャン)
  const qrRes = await fetch(`${baseUrl}/api/checkin/by-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketCode }),
  }).then(r => r.json());
  console.log('7. POST /api/checkin/by-ticket:', qrRes.success && qrRes.status === 'checked_in' ? 'PASS' : 'FAIL');

  // 8. GET /api/seat-status (Aレーン1番席)
  const seatRes = await fetch(`${baseUrl}/api/seat-status?lane=A&seat=1`).then(r => r.json());
  console.log('8. GET /api/seat-status:', seatRes.hasReservation && seatRes.ticket_code === 'A1000-1' ? 'PASS' : 'FAIL');

  // 9. POST /api/cancel (欠席処理 -> empty復帰)
  const cancelRes = await fetch(`${baseUrl}/api/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reservationId }),
  }).then(r => r.json());
  console.log('9. POST /api/cancel:', cancelRes.success ? 'PASS' : 'FAIL');

  // 再び最若席として発券できるか確認
  const reIssue = await fetch(`${baseUrl}/api/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId: 'TEST_01' }),
  }).then(r => r.json());
  console.log('9-2. Re-issue cancelled seat (A1000-1):', reIssue.ticket.ticket_code === 'A1000-1' ? 'PASS' : 'FAIL');

  // 10. POST /api/games/delete
  const delRes = await fetch(`${baseUrl}/api/games/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'TEST_01' }),
  }).then(r => r.json());
  console.log('10. POST /api/games/delete:', delRes.success ? 'PASS' : 'FAIL');

  console.log('--- All Backend Tests Finished ---');
}

runTests().catch(console.error);

