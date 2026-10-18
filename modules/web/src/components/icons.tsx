import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
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
export function FilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 2.5C10.3 6.7 5.5 10.4 5.5 15a6.5 6.5 0 0 0 13 0c0-4.6-4.8-8.3-6.5-12.5Z" />
    </Icon>
  );
}
export function LabelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20.25 3.75h-7.5a2 2 0 0 0-1.42.59l-7.5 7.5a2 2 0 0 0 0 2.82l5.51 5.51a2 2 0 0 0 2.82 0l7.5-7.5a2 2 0 0 0 .59-1.42Z" />
      <circle cx="16.25" cy="7.75" r=".8" fill="currentColor" stroke="none" />
    </Icon>
  );
}
export function OrganizationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="6" height="6" rx=".75" />
      <rect x="14.5" y="3.5" width="6" height="6" rx=".75" />
      <rect x="3.5" y="14.5" width="6" height="6" rx=".75" />
      <path d="M14.5 17.5h6m-3-3v6" />
    </Icon>
  );
}
