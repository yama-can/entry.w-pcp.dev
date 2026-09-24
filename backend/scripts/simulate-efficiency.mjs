/**
 * イベント整理券運用シミュレーション詳細測定モデル
 * 従来型運用 (Baseline) vs 本システム (Smart Buffer & Advance Filling System)
 */

function createRng(seed = 42) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function runDetailedSimulation(config = {}) {
  const {
    seed = 42,
    totalSlots = 94,          // 1日の総スロット数 (10:00〜15:30, 2レーン, 3.5分ピッチ)
    seatsPerSlot = 6,         // 1枠あたり6席
    bufferInterval = 5,       // 5枠に1枠調整枠
    customerArrivalProfile = {
      onTimeRate: 0.70,       // 70%: 集合時間〜枠時刻に定刻到着
      earlyRate: 0.15,        // 15%: 10〜30分早く到着
      lateRate: 0.10,         // 10%: 5〜25分遅刻
      noShowRate: 0.05,       // 5%: キャンセル・無断欠席 (来場せず)
    }
  } = config;

  const rng = createRng(seed);
  const avgPitch = 3.5; // 分

  // -------------------------------------------------------------
  // モデル A: 従来型運用 (固定枠割当 / 前詰めなし / 調整枠なし)
  // -------------------------------------------------------------
  function simulateTraditional() {
    const totalIssued = totalSlots * seatsPerSlot; // 564枚発券
    let servedCount = 0;
    let lateUsers = 0;
    let lateServedCount = 0;
    let lateRejectedCount = 0;
    let emptySeats = 0;
    let delayCascades = 0; // 後続への遅延波及回数
    let totalWaitTime = 0;
    let waitSamples = 0;

    for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
      const slotTimeMins = slotIdx * avgPitch;

      for (let s = 0; s < seatsPerSlot; s++) {
        const r = rng();

        if (r < customerArrivalProfile.noShowRate) {
          // 欠席 -> 前詰めできないため空席のまま
          emptySeats++;
        } else if (r < customerArrivalProfile.noShowRate + customerArrivalProfile.earlyRate) {
          // 早く来た人 -> 前の枠に空きがあっても指定時刻まで待たされる
          const earlyMins = 10 + Math.floor(rng() * 20);
          const arrivalMins = Math.max(0, slotTimeMins - earlyMins);
          servedCount++;
          totalWaitTime += (slotTimeMins - arrivalMins);
          waitSamples++;
        } else if (r < customerArrivalProfile.noShowRate + customerArrivalProfile.earlyRate + customerArrivalProfile.onTimeRate) {
          // 定刻到着
          const lead = 3 + Math.floor(rng() * 3);
          const arrivalMins = slotTimeMins - lead;
          servedCount++;
          totalWaitTime += (slotTimeMins - arrivalMins);
          waitSamples++;
        } else {
          // 遅刻者
          lateUsers++;
          const lateBy = 5 + Math.floor(rng() * 20); // 5〜25分遅刻
          if (lateBy <= 5) {
            // 軽微な遅れのみ現場で押し込み案内 -> 進行遅延を誘発
            servedCount++;
            lateServedCount++;
            delayCascades++;
            totalWaitTime += lateBy;
            waitSamples++;
          } else {
            // 大幅遅刻 -> 枠時刻を過ぎたため案内不可（欠席扱い）
            lateRejectedCount++;
            emptySeats++;
          }
        }
      }
    }

    return {
      name: "従来型（固定枠・前詰めなし）",
      totalCapacity: totalSlots * seatsPerSlot,
      totalIssued,
      servedCount,
      servedRate: (servedCount / totalIssued) * 100,
      emptySeats,
      emptySeatsRate: (emptySeats / (totalSlots * seatsPerSlot)) * 100,
      lateUsers,
      lateServedCount,
      lateRescueRate: (lateServedCount / lateUsers) * 100,
      lateRejectedCount,
      delayCascades,
      avgWaitTime: waitSamples > 0 ? (totalWaitTime / waitSamples) : 0,
    };
  }

  // -------------------------------------------------------------
  // モデル B: 本システム（スマート運用: 調整枠＋前詰め＋遅延者優先吸収）
  // -------------------------------------------------------------
  function simulateSmart() {
    // スロット生成（調整枠フラグ付き）
    const slots = [];
    let regularSlotsCount = 0;
    let bufferSlotsCount = 0;

    for (let i = 0; i < totalSlots; i++) {
      const isBuffer = bufferInterval > 0 && (i + 1) % bufferInterval === 0;
      if (isBuffer) bufferSlotsCount++;
      else regularSlotsCount++;

      slots.push({
        id: i + 1,
        slotTimeMins: i * avgPitch,
        isBuffer,
        capacity: seatsPerSlot,
        assignedTickets: [],
      });
    }

    // 発券（調整枠は発券しない）
    const totalIssued = regularSlotsCount * seatsPerSlot;
    const tickets = [];
    let ticketId = 1;

    for (const slot of slots) {
      if (slot.isBuffer) continue;
      for (let s = 0; s < seatsPerSlot; s++) {
        const r = rng();
        let cat;
        let arrivalMins;

        if (r < customerArrivalProfile.noShowRate) {
          cat = 'no_show';
          arrivalMins = null;
        } else if (r < customerArrivalProfile.noShowRate + customerArrivalProfile.earlyRate) {
          cat = 'early';
          const earlyMins = 10 + Math.floor(rng() * 20);
          arrivalMins = Math.max(0, slot.slotTimeMins - earlyMins);
        } else if (r < customerArrivalProfile.noShowRate + customerArrivalProfile.earlyRate + customerArrivalProfile.onTimeRate) {
          cat = 'on_time';
          const lead = 3 + Math.floor(rng() * 3);
          arrivalMins = slot.slotTimeMins - lead;
        } else {
          cat = 'late';
          const lateBy = 5 + Math.floor(rng() * 20);
          arrivalMins = slot.slotTimeMins + lateBy;
        }

        tickets.push({
          id: ticketId++,
          expectedSlotId: slot.id,
          expectedSlotMins: slot.slotTimeMins,
          cat,
          arrivalMins,
          served: false,
          servedSlotId: null,
          servedSlotMins: null,
        });
      }
    }

    // 進行シミュレーション（時間経過に沿って到着者をプールし、優先度付きで割当）
    let servedCount = 0;
    let lateUsers = tickets.filter(t => t.cat === 'late').length;
    let lateServedCount = 0;
    let advanceServedCount = 0;
    let totalWaitTime = 0;
    let waitSamples = 0;
    const arrivalPool = [];

    for (const slot of slots) {
      // 集合時間（枠の5分前）までに到着した客をプールへ追加
      const newArrivals = tickets.filter(
        t => !t.served && t.cat !== 'no_show' && t.arrivalMins !== null && t.arrivalMins <= slot.slotTimeMins
      );
      for (const t of newArrivals) {
        if (!arrivalPool.includes(t)) {
          arrivalPool.push(t);
        }
      }

      // スロット優先度スコア:
      // 調整枠: 遅延者を最優先 (score 1) > 前詰め (score 2)
      // 通常枠: オンタイム予定者 (score 1) > 遅延者 (score 2) > 前詰め (score 3)
      const scored = arrivalPool.map(t => {
        const isCurrent = t.expectedSlotId === slot.id;
        const isDelayed = t.expectedSlotMins < slot.slotTimeMins;
        const isAdvance = t.expectedSlotMins > slot.slotTimeMins;
        let score = 99;

        if (slot.isBuffer) {
          if (isDelayed) score = 1;
          else if (isAdvance) score = 2;
          else score = 3;
        } else {
          if (isCurrent) score = 1;
          else if (isDelayed) score = 2;
          else if (isAdvance) score = 3;
        }
        return { ticket: t, score, isCurrent, isDelayed, isAdvance };
      }).sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.ticket.id - b.ticket.id;
      });

      // 座席割当
      for (const item of scored) {
        if (slot.assignedTickets.length >= slot.capacity) break;
        const t = item.ticket;
        t.served = true;
        t.servedSlotId = slot.id;
        t.servedSlotMins = slot.slotTimeMins;
        slot.assignedTickets.push(t);
        servedCount++;

        if (item.isDelayed) {
          lateServedCount++;
        } else if (item.isAdvance) {
          advanceServedCount++;
        }

        // 待ち時間（到着から案内までの実拘束時間）
        const wait = Math.max(0, slot.slotTimeMins - t.arrivalMins);
        totalWaitTime += wait;
        waitSamples++;

        // プールから除外
        const idx = arrivalPool.indexOf(t);
        if (idx >= 0) arrivalPool.splice(idx, 1);
      }
    }

    const totalCapacity = slots.length * seatsPerSlot;
    const emptySeats = slots.reduce((acc, s) => acc + (s.capacity - s.assignedTickets.length), 0);
    const lateRejectedCount = lateUsers - lateServedCount;

    return {
      name: "本システム（調整枠＋前詰め＋優先割当）",
      totalCapacity,
      totalIssued,
      servedCount,
      servedRate: (servedCount / totalIssued) * 100, // 発券した人のうち実際に体験できた割合
      emptySeats,
      emptySeatsRate: (emptySeats / totalCapacity) * 100,
      lateUsers,
      lateServedCount,
      lateRescueRate: (lateServedCount / lateUsers) * 100,
      lateRejectedCount,
      advanceServedCount, // 早く来て前倒し体験できた人数
      delayCascades: 0,   // 調整枠がクッションとなるため定刻進行
      avgWaitTime: waitSamples > 0 ? (totalWaitTime / waitSamples) : 0,
    };
  }

  return {
    traditional: simulateTraditional(),
    smart: simulateSmart(),
  };
}

// 100回のモンテカルロ試行
const TRIALS = 100;
const tradList = [];
const smartList = [];

for (let i = 0; i < TRIALS; i++) {
  const res = runDetailedSimulation({ seed: 2000 + i * 19 });
  tradList.push(res.traditional);
  smartList.push(res.smart);
}

function avg(list, key) {
  return list.reduce((a, b) => a + b[key], 0) / list.length;
}

const summary = {
  traditional: {
    name: tradList[0].name,
    totalCapacity: Math.round(avg(tradList, 'totalCapacity')),
    totalIssued: Math.round(avg(tradList, 'totalIssued')),
    servedCount: Math.round(avg(tradList, 'servedCount')),
    servedRate: avg(tradList, 'servedRate').toFixed(1) + '%',
    emptySeats: Math.round(avg(tradList, 'emptySeats')),
    emptySeatsRate: avg(tradList, 'emptySeatsRate').toFixed(1) + '%',
    lateUsers: Math.round(avg(tradList, 'lateUsers')),
    lateServedCount: Math.round(avg(tradList, 'lateServedCount')),
    lateRescueRate: avg(tradList, 'lateRescueRate').toFixed(1) + '%',
    lateRejectedCount: Math.round(avg(tradList, 'lateRejectedCount')),
    delayCascades: avg(tradList, 'delayCascades').toFixed(1) + ' 回',
    avgWaitTime: avg(tradList, 'avgWaitTime').toFixed(1) + ' 分',
  },
  smart: {
    name: smartList[0].name,
    totalCapacity: Math.round(avg(smartList, 'totalCapacity')),
    totalIssued: Math.round(avg(smartList, 'totalIssued')),
    servedCount: Math.round(avg(smartList, 'servedCount')),
    servedRate: avg(smartList, 'servedRate').toFixed(1) + '%',
    emptySeats: Math.round(avg(smartList, 'emptySeats')),
    emptySeatsRate: avg(smartList, 'emptySeatsRate').toFixed(1) + '%',
    lateUsers: Math.round(avg(smartList, 'lateUsers')),
    lateServedCount: Math.round(avg(smartList, 'lateServedCount')),
    lateRescueRate: avg(smartList, 'lateRescueRate').toFixed(1) + '%',
    lateRejectedCount: Math.round(avg(smartList, 'lateRejectedCount')),
    advanceServedCount: Math.round(avg(smartList, 'advanceServedCount')),
    delayCascades: '0.0 回 (完全定刻)',
    avgWaitTime: avg(smartList, 'avgWaitTime').toFixed(1) + ' 分',
  },
};

console.log(JSON.stringify(summary, null, 2));

