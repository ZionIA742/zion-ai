import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Zion AI",
  description: "IA comercial para lojas de piscinas",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
