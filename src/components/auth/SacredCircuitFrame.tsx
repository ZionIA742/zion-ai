import type { ReactNode } from "react";
import "./SacredCircuit.css";

type SacredCircuitFrameProps = {
  variant: "commercial" | "admin";
  children: ReactNode;
};

export function SacredCircuitFrame({
  variant,
  children,
}: SacredCircuitFrameProps) {
  const admin = variant === "admin";
  const id = `sacred-${variant}`;

  const outer = admin
    ? "M40 2 H410 L448 40 V168 L458 180 V355 L417 398 H43 L2 355 V180 L12 168 V40 Z"
    : "M34 2 H386 L418 34 V366 L386 398 H34 L2 366 V34 Z";

  const inner = admin
    ? "M54 13 H396 L437 54 V350 L400 385 H60 L23 350 V54 Z"
    : "M48 13 H372 L405 48 V350 L372 385 H48 L15 350 V48 Z";

  const geometry = admin
    ? "M54 13 L23 48 V76 M396 13 L437 54 V76 M23 320 L85 385 M437 320 L375 385"
    : "M48 13 L15 48 V76 M372 13 L405 48 V76 M15 320 L76 385 M405 320 L344 385";

  const highlights = admin
    ? "M12 40 L40 2 H90 M360 2 H410 L448 40 M12 85 V168 M448 85 V168 M2 336 V355 L43 398 H84 M376 398 H417 L458 355 V336 M168 398 H292"
    : "M2 34 L34 2 H98 M322 2 H386 L418 34 M2 340 V366 L34 398 M386 398 L418 366 V340 M146 398 H274";

  return (
    <section className={`zion-sacred-frame zion-sacred-frame--${variant}`}>
      <svg
        aria-hidden="true"
        className="zion-sacred-frame-art"
        viewBox={admin ? "0 0 460 400" : "0 0 420 400"}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a2632" />
            <stop offset="40%" stopColor="#04151f" />
            <stop offset="75%" stopColor="#04151e" />
            <stop offset="100%" stopColor="#082631" />
          </linearGradient>

          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a0f7ff" />
            <stop offset="45%" stopColor="#16768d" />
            <stop offset="75%" stopColor="#04d7ee" />
            <stop offset="100%" stopColor="#9bffff" />
          </linearGradient>

          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.3" />
          </filter>
        </defs>

        <path
          d={outer}
          fill={`url(#${id}-fill)`}
          stroke={`url(#${id}-edge)`}
          strokeWidth="1.3"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={inner}
          fill="none"
          stroke="#326a7a"
          strokeWidth="0.8"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={geometry}
          fill="none"
          stroke="#2b6576"
          strokeWidth="0.8"
          opacity="0.85"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={highlights}
          fill="none"
          stroke="#00d9ff"
          strokeWidth="4"
          opacity="0.9"
          className="zion-sacred-frame-pulse"
          filter={`url(#${id}-glow)`}
        />

        <path
          d={highlights}
          fill="none"
          stroke="#a0f7ff"
          strokeWidth="1.3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="zion-sacred-content">
        {children}
      </div>
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
      <path d="M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6M9 9h6v6H9z" />
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

export function EyeIcon({
  visible = false,
}: {
  visible?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {visible ? (
        <>
          <path d="M17.9 17.9A10.7 10.7 0 0 1 12 20C5 20 1 12 1 12a13.8 13.8 0 0 1 3.2-4.8" />
          <path d="M9.9 4.3A11 11 0 0 1 12 4c7 0 11 8 11 8a13.6 13.6 0 0 1-1.7 2.7" />
          <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
          <path d="m2 2 20 20" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
