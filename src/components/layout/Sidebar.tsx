"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  {
    label: "Dashboard",
    href: "/dashboard",
  },
  {
    label: "CRM",
    href: "/crm",
  },
  {
    label: "Inbox",
    href: "/inbox",
  },
  {
    label: "Configurações",
    href: "/configuracoes",
  },
  {
    label: "Onboarding",
    href: "/onboarding",
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-gray-200 bg-white h-screen flex flex-col">
      <div className="px-6 py-5 border-b border-gray-200">
        <h1 className="text-xl font-bold text-gray-900">ZION</h1>
        <p className="text-sm text-gray-500">Painel operacional</p>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "block rounded-lg px-4 py-3 text-sm font-medium transition",
                isActive
                  ? "bg-transparent text-black underline underline-offset-4 decoration-2"
                  : "bg-transparent text-black hover:underline hover:underline-offset-4 hover:decoration-2",
              ].join(" ")}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}