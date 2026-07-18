import Link from "next/link";

interface BrandMarkProps {
  href?: string;
  showSymbol?: boolean;
  className?: string;
}

function MarkSymbol() {
  return (
    <svg aria-hidden="true" className="h-7 w-7 shrink-0" viewBox="0 0 32 32" fill="none">
      <path
        d="M25.5 7.2C22.4 3.9 15.2 3.7 10.8 6.1c-4.5 2.4-4.4 6.2.4 7.4l9.5 2.5c4.5 1.2 4.6 5 .3 7.4-4.4 2.5-11.5 2.1-14.5-1.1"
        stroke="#1f59ff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M23.8 9.5c-3.2-2.2-8.7-2.4-11.9-.7-3.2 1.8-2.7 4.3 1.1 5.3l7.2 1.9c3.9 1 4.3 3.6 1 5.4-3.1 1.8-8.7 1.5-11.7-.7"
        stroke="#09a89c"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="24.8" cy="7.6" r="2.45" fill="white" stroke="#1f59ff" strokeWidth="1.8" />
    </svg>
  );
}

export function BrandMark({ href = "/", showSymbol = false, className = "" }: BrandMarkProps) {
  return (
    <Link
      href={href}
      aria-label="Searvia home"
      className={`inline-flex items-center gap-2 text-[1.65rem] font-bold leading-none tracking-[0.07em] text-[#111318] ${className}`}
    >
      {showSymbol ? <MarkSymbol /> : null}
      <span>searvia</span>
    </Link>
  );
}
