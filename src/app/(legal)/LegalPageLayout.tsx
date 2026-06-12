import Link from "next/link";
import type { ReactNode } from "react";

const PRODUCT_NAME = "ZION";
const CONTACT_EMAIL = "zion.ai.brasil@gmail.com";
const UPDATED_AT = "12 de junho de 2026";

type LegalLink = {
  href: string;
  label: string;
};

type LegalPageLayoutProps = {
  title: string;
  description: string;
  children: ReactNode;
};

const legalLinks: LegalLink[] = [
  { href: "/privacy-policy", label: "Política de Privacidade" },
  { href: "/terms-of-service", label: "Termos de Serviço" },
  { href: "/data-deletion", label: "Exclusão de Dados" },
];

function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-3xl border border-white/10 bg-zinc-900/70 p-6 shadow-2xl shadow-black/20 sm:p-8">
      <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
        {title}
      </h2>
      <div className="space-y-4 text-sm leading-7 text-zinc-200 sm:text-[15px]">
        {children}
      </div>
    </section>
  );
}

function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function LegalLinkGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {legalLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

export function LegalPageLayout({
  title,
  description,
  children,
}: LegalPageLayoutProps) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-zinc-950 px-4 py-8 text-zinc-50 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="rounded-[2rem] border border-white/10 bg-zinc-900/80 p-6 shadow-2xl shadow-black/25 sm:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Voltar para login
            </Link>

            <div className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-zinc-300">
              {PRODUCT_NAME}
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium text-zinc-400">Documentação pública</p>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {title}
            </h1>
            <p className="max-w-3xl text-sm leading-7 text-zinc-300 sm:text-base">
              {description}
            </p>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
              Última atualização: {UPDATED_AT}
            </p>
          </div>
        </header>

        <nav aria-label="Links legais" className="rounded-3xl border border-white/10 bg-zinc-900/65 p-4 shadow-xl shadow-black/15">
          <LegalLinkGrid />
        </nav>

        {children}

        <footer className="rounded-3xl border border-white/10 bg-zinc-900/65 p-6 text-sm text-zinc-300 shadow-xl shadow-black/15">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-white">{PRODUCT_NAME}</p>
              <p>Canal oficial de contato para estes documentos.</p>
            </div>

            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="break-all font-medium text-zinc-100 underline decoration-zinc-500 underline-offset-4 transition hover:decoration-zinc-200"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}

export { CONTACT_EMAIL, LegalList, LegalSection, PRODUCT_NAME, UPDATED_AT };
