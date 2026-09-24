/**
 * 2山分布における時間帯別（フェーズ別）ブレークダウン詳細シミュレーション
 */
function runPhaseBreakdown() {
  const phases = [
    { name: "開場〜午前ピーク (9:00〜11:30)", startMin: 0, endMin: 150, slotRange: "0〜42枠", note: "徐々に増え10:45頃に午前ピーク" },
    { name: "昼の谷間 (11:30〜13:00)", startMin: 150, endMin: 240, slotRange: "43〜68枠", note: "昼食で一時的に来場減＆遅刻率急増(18%)" },
    { name: "午後ピーク (13:00〜15:00)", startMin: 240, endMin: 360, slotRange: "69〜102枠", note: "1日最大の来場ラッシュ(早着25%)" },
    { name: "終盤〜閉会 (15:00〜16:00)", startMin: 360, endMin: 420, slotRange: "103〜120枠", note: "徐々に減少、撤収時間への遅延食い込み防止" },
  ];

  console.log(JSON.stringify(phases, null, 2));
}

runPhaseBreakdown();

