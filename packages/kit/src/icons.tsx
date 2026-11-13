import type { ReactNode } from 'react';

/** Les icônes du kit : traits simples, à la couleur du texte. Une icône seule dans un bouton exige un `aria-label`. */
const PATHS = {
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  modules: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  copilot: <path d="M12 3l1.8 4.9L19 9.5l-4.2 2.9L16 18l-4-3-4 3 1.2-5.6L5 9.5l5.2-1.6z" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  card: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="3" />
      <path d="M3 10h18" />
    </>
  ),
  barbell: <path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12" />,
  navigate: <path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" />,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  chef: <path d="M7 3v8a2 2 0 0 0 4 0V3M9 13v8M17 3c-2 2-2 6 0 9v9" />,
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="3" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="3" />
      <path d="M11 18h2" />
    </>
  ),
} as const satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 21, strong = false }: { name: IconName; size?: number; strong?: boolean }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strong ? 2.6 : 2} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}
