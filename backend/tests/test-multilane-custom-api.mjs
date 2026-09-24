// backend/test-multilane-custom-api.mjs
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
      } catch (e) {
        // wait
      }
      await sleep(300);
    }

    if (!ready) {
      throw new Error('Backend server did not start in time');
    }
    console.log('Backend server is ready.');

    // 1. 任意3レーン (A, B, C) での生成 (体験5分, 入替2分 = 7分サイクル, オフセット2分)
    console.log('\n--- 1. Testing Multi-Lane (A, B, C) Generation ---');
    const genRes = await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: '10',
      startMinute: '00',
      count: 6,
      seatsPerSlot: 2,
      lanes: ['A', 'B', 'C'],
      playDuration: 5,
      cleanupDuration: 2,
      laneOffset: 2,
    });
    console.log('Generate result:', genRes.data);

    const tlRes = await request('GET', '/api/timeline?day=1');
    const slots = tlRes.data.timeline;
    console.log(`Generated ${slots.length} slots:`);
    for (const s of slots) {
      console.log(`- Slot ${s.order_idx}: [${s.lane}組] ${s.slot_time} (次枠まで${s.duration_minutes}m, 体験${s.play_duration}m, 入替${s.cleanup_duration}m)`);
    }

    if (slots.length !== 6) throw new Error(`Expected 6 slots, got ${slots.length}`);
    const expectedSchedule = [
      { order: 0, lane: 'A', time: '10:00', dur: 2 },
      { order: 1, lane: 'B', time: '10:02', dur: 2 },
      { order: 2, lane: 'C', time: '10:04', dur: 3 },
      { order: 3, lane: 'A', time: '10:07', dur: 2 }, // A組の次回枠: 10:00 + 7分 = 10:07
      { order: 4, lane: 'B', time: '10:09', dur: 2 }, // B組の次回枠: 10:02 + 7分 = 10:09
      { order: 5, lane: 'C', time: '10:11' },         // C組の次回枠: 10:04 + 7分 = 10:11
    ];

    for (let i = 0; i < expectedSchedule.length; i++) {
      const exp = expectedSchedule[i];
      const actual = slots[i];
      if (actual.lane !== exp.lane || actual.slot_time !== exp.time) {
        throw new Error(`Slot ${i} mismatch: expected ${exp.lane} ${exp.time}, got ${actual.lane} ${actual.slot_time}`);
      }
      if (exp.dur && actual.duration_minutes !== exp.dur) {
        throw new Error(`Slot ${i} duration mismatch: expected ${exp.dur}, got ${actual.duration_minutes}`);
      }
      if (actual.play_duration !== 5 || actual.cleanup_duration !== 2) {
        throw new Error(`Slot ${i} play/cleanup duration mismatch: got ${actual.play_duration}m / ${actual.cleanup_duration}m`);
      }
    }
    console.log('=> SUCCESS: 3-Lane (A, B, C) 7-minute cycle with 2-minute offset verified accurately!');

    // 2. 枠ごとの個別カスタマイズ (/api/slots/update-slot)
    console.log('\n--- 2. Testing Slot Customization (update-slot) & Cascade ---');
    const slot1 = slots[1]; // B組 10:02
    console.log(`Updating slot 1 (B 10:02): duration 2m -> 4m, play 5m -> 6m...`);
    const updateRes = await request('POST', '/api/slots/update-slot', {
      slotId: slot1.id,
      durationMinutes: 4,
      playDuration: 6,
      cleanupDuration: 2,
    });
    console.log('Update result:', updateRes.data);

    const tlAfter = await request('GET', '/api/timeline?day=1');
    const updatedSlots = tlAfter.data.timeline;
    console.log('Slots after custom update:');
    for (const s of updatedSlots) {
      console.log(`- Slot ${s.order_idx}: [${s.lane}組] ${s.slot_time} (${s.duration_minutes}m, play:${s.play_duration}m) Seats[0]: ${s.seats[0]?.ticket_code}`);
    }

    // slot 1 is 10:02 (dur: 4). slot 2 (C組) should now be 10:06!
    if (updatedSlots[2].slot_time !== '10:06') {
      throw new Error(`Cascade failed: expected slot 2 to be 10:06, got ${updatedSlots[2].slot_time}`);
    }
    if (updatedSlots[2].seats[0].ticket_code !== 'C1006-1') {
      throw new Error(`Ticket code cascade failed: expected C1006-1, got ${updatedSlots[2].seats[0].ticket_code}`);
    }
    console.log('=> SUCCESS: Slot customization and cascade time/ticket recalculation verified!');

    // 3. C組レーンの発券・チェックイン・締め切り・PC席監視API (/api/seat-status)
    console.log('\n--- 3. Testing Lane C Ticket Issue, Checkin, Close, and Seat Status ---');
    // ゲームマスタ登録確認
    await request('POST', '/api/games', {
      id: 'G_ACTION',
      name: 'アクションアドベンチャー',
      command: 'action_game.exe',
    });

    // 枠0(A), 枠1(B)の全席(各2席)を発券して埋め、枠2(C組 10:06)を発券対象にする
    for (let i = 0; i < 4; i++) {
      await request('POST', '/api/issue', { day: 1, gameId: 'G_ACTION' });
    }

    // 次に発券されるのは C組 10:06 1番席
    const issueRes = await request('POST', '/api/issue', {
      day: 1,
      gameId: 'G_ACTION',
    });
    console.log('issueRes data:', issueRes.data);
    if (!issueRes.data?.ticket) {
      throw new Error(`Issue failed: ${JSON.stringify(issueRes.data)}`);
    }
    const cTicket = issueRes.data.ticket;
    console.log('Issued ticket:', cTicket);
    if (cTicket.lane !== 'C') {
      throw new Error(`Expected Lane C ticket, got ${cTicket.lane}`);
    }

    // チェックイン
    const checkinRes = await request('POST', '/api/checkin/by-ticket', {
      ticketCode: cTicket.ticket_code,
    });
    console.log(`Checkin ${cTicket.ticket_code} result:`, checkinRes.data);

    // C組スロットの締め切り
    const closeRes = await request('POST', '/api/slots/close', {
      slotId: updatedSlots[2].id,
    });
    console.log('Close slot 2 (C組) result:', closeRes.data);

    // /api/seat-status?lane=C&seat=1
    const seatStatusRes = await request('GET', '/api/seat-status?lane=C&seat=1');
    console.log('Seat status (Lane C, Seat 1):', seatStatusRes.data);
    if (seatStatusRes.data.lane !== 'C' || seatStatusRes.data.seat !== 1 || !seatStatusRes.data.hasReservation) {
      throw new Error('Seat status did not return Lane C Seat 1 correctly');
    }
    console.log('=> SUCCESS: Arbitrary lane C ticket lifecycle and PC monitoring verified!');

    console.log('\nALL MULTI-LANE & CUSTOMIZATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.kill();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
