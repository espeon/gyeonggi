import type { Cover } from './icons';

// fixture list for `?mock`, so the flow can be designed in any browser with no
// device and no daemon attached
export type AppEntry = {
  id: string;
  name: string;
  description: string | null;
  cover: Cover | null;
};

const PALETTE = [
  '#1d4ed8',
  '#0e7490',
  '#7c3aed',
  '#b45309',
  '#15803d',
  '#be123c',
  '#a21caf',
  '#4d7c0f',
  '#0369a1',
  '#9f1239',
];

function fixtureCover(label: string, i: number): Cover {
  const color = PALETTE[i % PALETTE.length];
  const glyph = label.slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="${color}"/><circle cx="96" cy="96" r="54" fill="rgba(255,255,255,0.16)"/><text x="96" y="120" font-family="sans-serif" font-size="76" font-weight="700" fill="#fff" text-anchor="middle">${glyph}</text></svg>`;
  return {
    url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    plate: color,
  };
}

export function mockApps(): AppEntry[] {
  const rows: Array<[string, string | null]> = [
    ['Spotify', 'music and podcasts'],
    ['Browser', 'the open web'],
    ['Calendar', 'your week at a glance'],
    ['Weather', 'forecast and radar'],
    ['Home Assistant', 'lights, locks, and scenes'],
    ['Clock', 'alarms and timers'],
    ['Notes', 'quick lists'],
    ['Podcasts', 'shows and episodes'],
    ['Files', 'downloads and shares'],
    ['Settings', null],
  ];
  return rows.map(([name, description], i) => ({
    id: `mock-${i}`,
    name,
    description,
    cover: fixtureCover(name, i),
  }));
}
