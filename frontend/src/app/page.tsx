const pages = [
  { href: "/kiosk", title: "発券", description: "整理券の発券と集合時間の案内" },
  { href: "/checkin", title: "受付", description: "来場者のチェックイン、遅刻・取消の処理" },
  { href: "/assignment", title: "枠割当", description: "到着者を枠と席へ割り当てる" },
  { href: "/inroom", title: "室内モニター", description: "確定した枠、席、準備状況を確認する" },
  { href: "/monitor", title: "呼び出しモニター", description: "来場者向けに整理券と席を表示する" },
  { href: "/scheduler", title: "進行", description: "入場・退場時刻と進行状況を管理する" },
  { href: "/admin", title: "設定", description: "枠、席、調整枠、メンテナンスを管理する" },
];

export default function Page() {
  return (
    <main className="main-container" style={{ maxWidth: "980px", margin: "0 auto", paddingTop: "48px" }}>
      <div className="card" style={{ padding: "32px" }}>
        <h1 style={{ margin: 0, fontSize: "1.6rem", color: "var(--text-main)" }}>整理券管理</h1>
        <p style={{ color: "var(--text-secondary)", margin: "8px 0 24px" }}>使用する画面を選択してください。</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
          {pages.map((page) => (
            <a key={page.href} href={page.href} className="card" style={{ display: "block", padding: "18px", textDecoration: "none", border: "1px solid var(--border-subtle)" }}>
              <strong style={{ display: "block", color: "var(--text-main)", fontSize: "1.05rem" }}>{page.title}</strong>
              <span style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "6px" }}>{page.description}</span>
              <span className="tabular font-mono" style={{ display: "block", color: "#38bdf8", fontSize: "0.78rem", marginTop: "12px" }}>{page.href}</span>
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}
