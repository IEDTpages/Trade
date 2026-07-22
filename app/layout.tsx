import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UN Comtrade — конструктор API-запросов",
  description: "Конструктор запросов к UN Comtrade с русскими справочниками стран, регионов и товаров HS.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
