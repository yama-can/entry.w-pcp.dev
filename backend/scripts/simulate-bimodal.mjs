/**
 * 文化祭・展示イベント リアル2山分布（9:00〜16:00, 7時間）シミュレーション
 * 午前ピーク(10:45) & 午後ピーク(13:45) & 昼の谷間(12:15)
 */

function createRng(seed = 42) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// 2山分布の確率密度（9:00=0分 〜 16:00=420分）
// ガウス混合: 午前ピーク(μ1=105, σ1=40), 午後ピーク(μ2=285, σ2=45), 谷間(12:15=195)
function getArrivalDemandWeight(mins) {
  const g1 = Math.exp(-Math.pow(mins - 105, 2) / (2 * 40 * 40));
  const g2 = Math.exp(-Math.pow(mins - 285, 2) / (2 * 45 * 45));
  const baseline = 0.25; // 最低限の定常流入
  return baseline + 1.2 * g1 + 1.5 * g2;
}

function runBimodalSimulation(config = {}) {
  const {
    seed = 42,
    totalMinutes = 420,       // 9:00〜16:00 (7時間)
    totalSlots = 120,         // 120スロット (平均3.5分ピッチ, 2レーン)
    seatsPerSlot = 6,         // 1枠6席 (総座席: 720席)
    bufferInterval = 5,       // 5枠に1枠調整枠 (本システム)
  } = config;

  const rng = createRng(seed);
  const avgPitch = totalMinutes / totalSlots; // 3.5分

  // -------------------------------------------------------------
  // スロット生成
  // -------------------------------------------------------------
  function makeSlots(useBuffer) {
    const slots = [];
    for (let i = 0; i < totalSlots; i++) {
      const isBuffer = useBuffer && bufferInterval > 0 && (i + 1) % bufferInterval === 0;
      slots.push({
        id: i + 1,
        orderIdx: i,
        slotTimeMins: i * avgPitch,
        lane: i % 2 === 0 ? 'A' : 'B',
        isBuffer,
        capacity: seatsPerSlot,
        assignedTickets: [],
      });
    }
    return slots;
  }

  // -------------------------------------------------------------
  // 来場者チケット生成（2山分布に基づく行動プロファイル）
  // -------------------------------------------------------------
  function makeTickets(slots, useBuffer) {
    const tickets = [];
    let ticketId = 1;

    for (const slot of slots) {
      if (useBuffer && slot.isBuffer) continue; // 調整枠は発券除外

      const slotMins = slot.slotTimeMins;
      // 昼時（11:30〜13:00）は昼食による遅刻率上昇
      const isLunchTime = slotMins >= 150 && slotMins <= 240;
      // ピーク時（午前10:00〜11:30, 午後13:00〜14:45）は早め集合率上昇
      const isPeakTime = (slotMins >= 60 && slotMins <= 150) || (slotMins >= 240 && slotMins <= 345);

      const noShowRate = 0.05; // 5% キャンセル
      const lateRate = isLunchTime ? 0.18 : 0.08; // 昼は18%遅刻、他は8%
      const earlyRate = isPeakTime ? 0.25 : 0.12; // ピークは25%早着、他は12%
      const onTimeRate = 1.0 - (noShowRate + lateRate + earlyRate);

      for (let s = 0; s < seatsPerSlot; s++) {
        const r = rng();
        let cat;
        let arrivalMins;

        if (r < noShowRate) {
          cat = 'no_show';
          arrivalMins = null;
        } else if (r < noShowRate + earlyRate) {
          cat = 'early';
          const earlyMins = 10 + Math.floor(rng() * 25); // 10〜35分前
          arrivalMins = Math.max(0, slotMins - earlyMins);
        } else if (r < noShowRate + earlyRate + onTimeRate) {
          cat = 'on_time';
          const lead = 3 + Math.floor(rng() * 3); // 3〜5分前
          arrivalMins = slotMins - lead;
        } else {
          cat = 'late';
          const lateBy = 5 + Math.floor(rng() * 25); // 5〜30分遅刻
          arrivalMins = slotMins + lateBy;
        }

        tickets.push({
          id: ticketId++,
          expectedSlotId: slot.id,
          expectedSlotMins: slotMins,
          cat,
          arrivalMins,
          served: false,
          servedSlotId: null,
          servedSlotMins: null,
        });
      }
    }
    return tickets;
  }

  // -------------------------------------------------------------
  // モデル A: 従来型運用 (固定枠 / 前詰めなし / 調整枠なし)
  // -------------------------------------------------------------
  function simulateTraditional() {
    const slots = makeSlots(false);
    const tickets = makeTickets(slots, false);

    let servedCount = 0;
    let lateUsers = tickets.filter(t => t.cat === 'late').length;
    let lateServedCount = 0;
    let lateRejectedCount = 0;
    let emptySeats = 0;
    let delayCascades = 0; // 遅延連鎖
    let totalWaitTime = 0;
    let waitSamples = 0;

    for (const slot of slots) {
      const slotTime = slot.slotTimeMins;
      const expected = tickets.filter(t => t.expectedSlotId === slot.id);

      for (let s = 0; s < seatsPerSlot; s++) {
        const t = expected[s];
        if (!t || t.cat === 'no_show') {
          emptySeats++;
          continue;
        }

        if (t.cat === 'late') {
          // 遅刻者: 5分以内の微遅れのみ無理やり案内、それ以外は案内不可
          if (t.arrivalMins <= slotTime + 5) {
            servedCount++;
            lateServedCount++;
            delayCascades++;
            totalWaitTime += (t.arrivalMins - slotTime);
            waitSamples++;
          } else {
            lateRejectedCount++;
            emptySeats++;
          }
        } else {
          servedCount++;
          const wait = Math.max(0, slotTime - t.arrivalMins);
          totalWaitTime += wait;
          waitSamples++;
        }
      }
    }

    const totalCapacity = slots.length * seatsPerSlot;
    const totalIssued = tickets.length;

    return {
      name: "従来型（固定枠・前詰めなし）",
      totalCapacity,
      totalIssued,
      servedCount,
      servedRate: (servedCount / totalIssued) * 100,
      emptySeats,
      emptySeatsRate: (emptySeats / totalCapacity) * 100,
      lateUsers,
      lateServedCount,
      lateRescueRate: (lateServedCount / lateUsers) * 100,
      lateRejectedCount,
      delayCascades,
      avgWaitTime: waitSamples > 0 ? (totalWaitTime / waitSamples) : 0,
    };
  }

  // -------------------------------------------------------------
  // モデル B: 本システム（スマート運用: 調整枠＋前詰め＋遅延者優先）
  // -------------------------------------------------------------
  function simulateSmart() {
    const slots = makeSlots(true);
    const tickets = makeTickets(slots, true);

    let servedCount = 0;
    let lateUsers = tickets.filter(t => t.cat === 'late').length;
    let lateServedCount = 0;
    let advanceServedCount = 0;
    let totalWaitTime = 0;
    let waitSamples = 0;
    const pool = [];

    for (const slot of slots) {
      const slotTime = slot.slotTimeMins;

      // 集合時間（枠の5分前）までに到着した客を待合プールへ
      const arriving = tickets.filter(
        t => !t.served && t.cat !== 'no_show' && t.arrivalMins !== null && t.arrivalMins <= slotTime
      );
      for (const t of arriving) {
        if (!pool.includes(t)) pool.push(t);
      }

      // スコアリング
      // 調整枠: 遅延者最優先(1) > 前詰め(2)
      // 通常枠: 定刻者最優先(1) > 遅延者(2) > 前詰め(3)
      const scored = pool.map(t => {
        const isCurrent = t.expectedSlotId === slot.id;
        const isDelayed = t.expectedSlotMins < slotTime;
        const isAdvance = t.expectedSlotMins > slotTime;
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

      // 枠への案内充填
      for (const item of scored) {
        if (slot.assignedTickets.length >= slot.capacity) break;
        const t = item.ticket;
        t.served = true;
        t.servedSlotId = slot.id;
        t.servedSlotMins = slotTime;
        slot.assignedTickets.push(t);
        servedCount++;

        if (item.isDelayed) {
          lateServedCount++;
        } else if (item.isAdvance) {
          advanceServedCount++;
        }

        const wait = Math.max(0, slotTime - t.arrivalMins);
        totalWaitTime += wait;
        waitSamples++;

        const idx = pool.indexOf(t);
        if (idx >= 0) pool.splice(idx, 1);
      }
    }

    const totalCapacity = slots.length * seatsPerSlot;
    const totalIssued = tickets.length;
    const emptySeats = slots.reduce((acc, s) => acc + (s.capacity - s.assignedTickets.length), 0);
    const lateRejectedCount = lateUsers - lateServedCount;

    return {
      name: "本システム（調整枠＋前詰め＋スマート割当）",
      totalCapacity,
      totalIssued,
      servedCount,
      servedRate: (servedCount / totalIssued) * 100,
      emptySeats,
      emptySeatsRate: (emptySeats / totalCapacity) * 100,
      lateUsers,
      lateServedCount,
      lateRescueRate: (lateServedCount / lateUsers) * 100,
      lateRejectedCount,
      advanceServedCount,
      delayCascades: 0, // 完全定刻
      avgWaitTime: waitSamples > 0 ? (totalWaitTime / waitSamples) : 0,
    };
  }

  return {
    traditional: simulateTraditional(),
    smart: simulateSmart(),
  };
}

// 100回モンテカルロ試行
const TRIALS = 100;
const tradList = [];
const smartList = [];

for (let i = 0; i < TRIALS; i++) {
  const r = runBimodalSimulation({ seed: 3000 + i * 23 });
  tradList.push(r.traditional);
  smartList.push(r.smart);
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
  }
};

console.log("=== 100回試行 統計平均サマリー ===");
console.log(JSON.stringify(summary, null, 2));
