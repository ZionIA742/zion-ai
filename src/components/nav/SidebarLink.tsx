"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

type Props = {
  href: string
  label: string
}

export default function SidebarLink({ href, label }: Props) {
  const pathname = usePathname()
  const ativo = pathname === href

  return (
    <Link
      href={href}
      className={[
        "block px-4 py-2 rounded-lg",
        ativo ? "bg-gray-100 font-medium" : "hover:bg-gray-100",
      ].join(" ")}
    >
      {label}
    </Link>
  )
}