import type { SVGProps } from "react";
import { asterFlowerPath } from "./aster-mark-path";

/** Small navigation glyphs are drawn on their native 20px grid. */
function NavIcon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function AsterMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <rect width="28" height="28" rx="8" fill="currentColor" />
      <path d={asterFlowerPath} fill="var(--sidebar)" />
    </svg>
  );
}

export function AddTaskIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <circle cx="10" cy="10" r="9" fill="currentColor" />
      <path
        d="M10 5.5v9M5.5 10h9"
        stroke="var(--sidebar)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function FocusNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <circle cx="10" cy="10" r="3.25" />
      <circle cx="10" cy="10" r=".75" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}
export function InboxNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <path d="M3.75 4.75h12.5l1.5 7v3.5a1 1 0 0 1-1 1H3.25a1 1 0 0 1-1-1v-3.5l1.5-7ZM2.75 11.75h4l1.5 2h3.5l1.5-2h4" />
    </NavIcon>
  );
}
export function TodayNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <rect x="2.75" y="4.75" width="14.5" height="12.5" rx="1.5" />
      <path d="M6.75 2.75v4M13.25 2.75v4M2.75 8.75h14.5" />
      <rect
        x="6"
        y="11"
        width="3"
        height="3"
        rx=".5"
        fill="currentColor"
        stroke="none"
      />
    </NavIcon>
  );
}
export function HabitsNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <path d="M17.25 9V6.25a1.5 1.5 0 0 0-1.5-1.5H4.25a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h5M6.75 2.75v4M13.25 2.75v4M2.75 8.75h14.5M11.5 15l2 2 4-4" />
    </NavIcon>
  );
}
export function LedgerNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 5.75V10l3 1.75" />
    </NavIcon>
  );
}
export function WeeklyNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <path d="M3.75 3.75v12.5h12.5M7.75 12.25v-3.5M11.75 12.25v-7M15.75 12.25v-5" />
    </NavIcon>
  );
}
export function CostReportNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <path d="m4.75 2.75 1.75 1 1.75-1 1.75 1 1.75-1 1.75 1 1.75-1v14.5l-1.75-1-1.75 1-1.75-1-1.75 1-1.75-1-1.75 1V2.75ZM7.75 7.25h4.5M7.75 10.25h4.5M7.75 13.25h2.5" />
    </NavIcon>
  );
}
export function SidebarToggleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1.5" />
      <path d="M7.25 3.75v12.5" />
    </NavIcon>
  );
}

export function TodayCalendarIcon({
  day = new Date().getDate(),
  ...props
}: SVGProps<SVGSVGElement> & { day?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect x="3" y="4" width="18" height="18" rx="2.5" />
      <path d="M16 2v4M8 2v4M3 9.5h18" />
      <text
        x="12"
        y="17.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="650"
        fill="currentColor"
        stroke="none"
        fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"
      >
        {day}
      </text>
    </svg>
  );
}

export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <path d="M10 2.75C8.5 6.25 4.75 9.25 4.75 13a5.25 5.25 0 0 0 10.5 0c0-3.75-3.75-6.75-5.25-10.25Z" />
    </NavIcon>
  );
}

export function LabelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <path d="M17.25 2.75h-6a1.5 1.5 0 0 0-1.06.44l-7 7a1.5 1.5 0 0 0 0 2.12l4.5 4.5a1.5 1.5 0 0 0 2.12 0l7-7a1.5 1.5 0 0 0 .44-1.06V2.75Z" />
      <circle cx="13.75" cy="6.25" r=".85" fill="currentColor" stroke="none" />
    </NavIcon>
  );
}

export function OrganizationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <rect x="2.75" y="2.75" width="5" height="5" rx=".75" />
      <rect x="12.25" y="2.75" width="5" height="5" rx=".75" />
      <rect x="2.75" y="12.25" width="5" height="5" rx=".75" />
      <path d="M12.25 14.75h5m-2.5-2.5v5" />
    </NavIcon>
  );
}

export function UpcomingNavIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <NavIcon {...props}>
      <rect x="2.75" y="3.75" width="14.5" height="13.5" rx="1.5" />
      <path d="M2.75 7.75h14.5" />
      <g fill="currentColor" stroke="none">
        <circle cx="6.5" cy="11" r=".9" />
        <circle cx="10" cy="11" r=".9" />
        <circle cx="13.5" cy="11" r=".9" />
        <circle cx="6.5" cy="14" r=".9" />
        <circle cx="10" cy="14" r=".9" />
      </g>
    </NavIcon>
  );
}
