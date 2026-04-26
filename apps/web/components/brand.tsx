import Link from "next/link";

export function Brand() {
  return (
    <Link aria-label="Taste Lab home" className="brand" href="/dashboard">
      <span className="brand-mark">
        <svg aria-hidden="true" viewBox="0 0 40 40">
          <path d="m20 3 15 8.5v17L20 37 5 28.5v-17L20 3Z" />
          <path d="m6 12 14 8 14-8M20 20v16" />
          <path d="m13 24 7 4 7-4" />
        </svg>
      </span>
      <span>
        <strong>TASTE LAB</strong>
      </span>
    </Link>
  );
}
