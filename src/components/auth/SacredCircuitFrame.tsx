import type { ReactNode } from "react";

type SacredCircuitFrameProps = {
  variant: "commercial" | "admin";
  children: ReactNode;
};

const frameClip = "polygon(0 28px, 28px 0, calc(100% - 28px) 0, 100% 28px, 100% calc(100% - 28px), calc(100% - 28px) 100%, 28px 100%, 0 calc(100% - 28px))";

export function SacredCircuitFrame({ variant, children }: SacredCircuitFrameProps) {
  return (
    <section
      className={`relative w-full overflow-hidden bg-[#03141e]/95 shadow-[0_28px_90px_rgba(0,0,0,0.7)] backdrop-blur-md ${
        variant === "admin" ? "max-w-[520px]" : "max-w-[460px]"
      }`}
      style={{ clipPath: frameClip }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 border border-cyan-300/90 shadow-[0_0_24px_rgba(34,211,238,0.35)]"
        style={{ clipPath: frameClip }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[8px] border border-cyan-400/35"
        style={{ clipPath: frameClip }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-px w-28 -translate-x-1/2 bg-cyan-200 shadow-[0_0_18px_5px_rgba(34,211,238,0.75)]" />
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 h-px w-36 -translate-x-1/2 bg-cyan-200 shadow-[0_0_18px_5px_rgba(34,211,238,0.8)]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 h-16 w-px bg-cyan-300/70 shadow-[0_0_12px_3px_rgba(34,211,238,0.55)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 h-16 w-px bg-cyan-300/70 shadow-[0_0_12px_3px_rgba(34,211,238,0.55)]" />
      <div className="relative z-10 px-8 py-10 sm:px-11 sm:py-12">{children}</div>
    </section>
  );
}

export function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="5" y="10" width="14" height="10" rx="1.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

export function CodeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
    </svg>
  );
}

export function ShieldLockIcon({ className = "h-12 w-11" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 56" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M24 2 43 9v15c0 13-8 23-19 29C13 47 5 37 5 24V9l19-7Z" />
      <rect x="17" y="23" width="14" height="11" rx="1.5" />
      <path d="M20 23v-4a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
