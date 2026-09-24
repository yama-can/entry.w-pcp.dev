// backend/test-lane-pitch-api.mjs
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

    // 1. スロット生成 (A組3分、B組4分、計6枠)
    console.log('\n--- 1. Testing Slot Generation with pitchMinutesA=3, pitchMinutesB=4 ---');
    const genRes = await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: '10',
      startMinute: '00',
      count: 6,
      seatsPerSlot: 2,
      pitchMinutesA: 3,
      pitchMinutesB: 4,
    });
    console.log('Generate result:', genRes.data);

    const slotsRes = await request('GET', '/api/timeline?day=1');
    const slots = slotsRes.data.timeline;
    console.log(`Generated ${slots.length} slots:`);
    for (const s of slots) {
      console.log(`- Slot ${s.order_idx}: [${s.lane}組] ${s.slot_time} (${s.duration_minutes}分枠)`);
    }

    if (slots.length !== 6) throw new Error(`Expected 6 slots, got ${slots.length}`);
    const expectedSchedule = [
      { order: 0, lane: 'A', time: '10:00', dur: 3 },
      { order: 1, lane: 'B', time: '10:03', dur: 4 },
      { order: 2, lane: 'A', time: '10:07', dur: 3 },
      { order: 3, lane: 'B', time: '10:10', dur: 4 },
      { order: 4, lane: 'A', time: '10:14', dur: 3 },
      { order: 5, lane: 'B', time: '10:17', dur: 4 },
    ];

    for (let i = 0; i < expectedSchedule.length; i++) {
      const exp = expectedSchedule[i];
      const actual = slots[i];
      if (actual.lane !== exp.lane || actual.slot_time !== exp.time || actual.duration_minutes !== exp.dur) {
        throw new Error(`Slot ${i} mismatch: expected ${JSON.stringify(exp)}, got ${actual.lane} ${actual.slot_time} ${actual.duration_minutes}m`);
      }
    }
    console.log('=> SUCCESS: Alternating pitch schedule (3m, 4m, 3m, 4m...) verified accurately!');

    // 2. 終了時刻指定での自動枠数計算の検証 (10:00 〜 10:35、平均3.5分/枠 ➔ 10枠)
    console.log('\n--- 2. Testing End Time calculation with A=3m, B=4m (Avg 3.5m) ---');
    const endGenRes = await request('POST', '/api/slots/generate', {
      day: 1,
      startHour: '10',
      startMinute: '00',
      endHour: '10',
      endMinute: '35',
      seatsPerSlot: 2,
      pitchMinutesA: 3,
      pitchMinutesB: 4,
    });
    console.log('Generate by end time result:', endGenRes.data);
    const slotsEndRes = await request('GET', '/api/timeline?day=1');
    const endSlots = slotsEndRes.data.timeline;
    console.log(`Generated ${endSlots.length} slots for 10:00 to 10:35.`);
    if (endSlots.length !== 10) {
      throw new Error(`Expected 10 slots for 35 min span at 3.5m/slot, got ${endSlots.length}`);
    }
    const lastSlot = endSlots[endSlots.length - 1];
    console.log(`Last slot: [${lastSlot.lane}組] ${lastSlot.slot_time} (${lastSlot.duration_minutes}分枠)`);
    // 10枠: 5 cycles of 7min = 35min. Last slot starts at 10:31, dur 4m, ends at 10:35.
    if (lastSlot.slot_time !== '10:31' || lastSlot.lane !== 'B' || lastSlot.duration_minutes !== 4) {
      throw new Error(`Last slot mismatch: expected B 10:31 4m, got ${lastSlot.lane} ${lastSlot.slot_time} ${lastSlot.duration_minutes}m`);
    }
    console.log('=> SUCCESS: End time calculation with lane pitch verified!');

    console.log('\nALL LANE PITCH TESTS PASSED SUCCESSFULLY!');
  } finally {
    server.kill();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
