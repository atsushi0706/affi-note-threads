import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "affi-note-threads | アフィリエイト記事ジェネレーター",
  description: "LP全文を入れるだけで、note記事とThreads投稿を生成。どの分野でも使える汎用アフィリエイトツール。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
