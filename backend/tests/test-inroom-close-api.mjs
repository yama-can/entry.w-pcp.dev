// backend/test-inroom-close-api.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
        } catch {
          resolve({ status: res.statusCode, raw: responseBody });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('--- Starting Backend Server ---');
  const server = spawn('node', ['--experimental-strip-types', 'backend/src/index.ts'], {
    stdio: 'inherit',
  });

  try {
    let ready = false;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await request('GET', '/api/games');
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (e) {}
      await sleep(300);
    }
    if (!ready) throw new Error('Server start failed');

    console.log('--- Testing In-Room & Seat-Status with Close Flow ---');

    // 1. スロット生成 (Day 1, 10:00〜, 4枠)
    await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: 10,
      startMinute: 0,
      count: 4,
      seatsPerSlot: 6,
    });

    // 2. 発券 (10:00 A組 1番席)
    const issueRes = await request('POST', '/api/issue', { gameId: 'ACT_01' });
    console.log('Issued ticket:', issueRes.data.ticket.ticket_code);

    // 3. 締め切り前: seat-status API を確認 -> まだ締め切られていないので idle になるべき
    const seatBeforeClose = await request('GET', '/api/seat-status?lane=A&seat=1');
    console.log('Seat 1 status BEFORE close:', seatBeforeClose.data.status, 'hasReservation:', seatBeforeClose.data.hasReservation);

    // 4. チェックイン
    await request('POST', '/api/checkin/toggle', { reservationId: issueRes.data.ticket.reservation_id });

    // 5. 締め切りを実行 (10:00 A組 スロット)
    const timelineRes = await request('GET', '/api/timeline?day=1');
    const slot0 = timelineRes.data.timeline[0];
    console.log(`Closing slot ${slot0.id} (${slot0.slot_time} ${slot0.lane}組)...`);
    const closeRes = await request('POST', '/api/slots/close', { slotId: slot0.id });
    console.log('Close result:', closeRes.data);

    // 6. 締め切り後: seat-status API を確認 -> 締め切られたので checked_in & game_name が取得できるべき
    const seatAfterClose = await request('GET', '/api/seat-status?lane=A&seat=1');
    console.log('Seat 1 status AFTER close:', seatAfterClose.data.status, 'game:', seatAfterClose.data.game_name, 'ticket:', seatAfterClose.data.ticket_code);

    // 7. 検証判定
    if (!seatBeforeClose.data.hasReservation && seatAfterClose.data.hasReservation && seatAfterClose.data.status === 'checked_in') {
      console.log('>>> SUCCESS: In-Room / Seat-Status is strictly bound to closed slots!');
    } else {
      throw new Error('Test failed: seat status does not properly reflect closed slot transition');
    }

  } finally {
    server.kill();
  }
}

run().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});

