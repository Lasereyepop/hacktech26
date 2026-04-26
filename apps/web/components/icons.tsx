import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconShell({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M4 13h6V4H4v9Zm10 7h6V4h-6v16ZM4 20h6v-4H4v4Z" />
    </IconShell>
  );
}

export function CritiqueIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M4 5h16v10H7l-3 3V5Zm5 4h6M9 12h4" />
    </IconShell>
  );
}

export function ProjectsIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M4 6h6l2 2h8v10H4V6Zm0 5h16" />
    </IconShell>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </IconShell>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </IconShell>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-1" />
    </IconShell>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h1" />
    </IconShell>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="m5 12 4 4L19 6" />
    </IconShell>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M13 3 8 21M19 8 5 16M16 4l4 4M4 16l4 4" />
    </IconShell>
  );
}

export function GoogleIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24" {...props}>
      <path
        d="M20.2 12.2c0-.7-.1-1.3-.2-1.9h-7.8v3.6h4.5a3.8 3.8 0 0 1-1.7 2.5v2.1h2.8c1.6-1.5 2.4-3.6 2.4-6.3Z"
        fill="#4285f4"
      />
      <path
        d="M12.2 20.4c2.3 0 4.2-.8 5.6-2.1L15 16.2c-.8.5-1.7.8-2.8.8-2.2 0-4-1.5-4.7-3.5H4.6v2.2a8.5 8.5 0 0 0 7.6 4.7Z"
        fill="#34a853"
      />
      <path
        d="M7.5 13.5a5.1 5.1 0 0 1 0-3.2V8.1H4.6a8.5 8.5 0 0 0 0 7.6l2.9-2.2Z"
        fill="#fbbc05"
      />
      <path
        d="M12.2 6.8c1.2 0 2.4.4 3.2 1.3l2.4-2.4a8.2 8.2 0 0 0-5.6-2.1 8.5 8.5 0 0 0-7.6 4.7l2.9 2.2c.7-2.2 2.5-3.7 4.7-3.7Z"
        fill="#ea4335"
      />
    </svg>
  );
}

export function MonitorIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </IconShell>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </IconShell>
  );
}

export function HandIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </IconShell>
  );
}

export function PenIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </IconShell>
  );
}

export function EraserIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="m7 21-4-4 10-10 8 8-6 6H7Z" />
      <path d="m9 15 6-6" />
      <path d="M3 21h18" />
    </IconShell>
  );
}

export function CommentIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </IconShell>
  );
}

export function ResourcesIcon(props: IconProps) {
  return (
    <IconShell {...props} strokeWidth="1.5">
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <circle cx="17.5" cy="6.5" r="3.5" />
      <path d="M6.5 3L10 6.5 6.5 10 3 6.5 6.5 3z" />
      <path d="M14 17.5h7M17.5 14v7" />
    </IconShell>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </IconShell>
  );
}

export function MoonIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </IconShell>
  );
}
