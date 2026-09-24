import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "文化祭ゲーム体験 整理券・運用管理システム",
  description: "完全オフラインLAN対応 整理券・チェックイン・機材連携システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
