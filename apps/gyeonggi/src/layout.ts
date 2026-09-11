// pure scene geometry, no DOM. the viewport origin, both layout modes, the
// label positions, and the mirror all fall out of computeMetrics and the flow
// curves, so retuning one of them moves the rest together

// each flow curve's knots are tuned at distances 0..3; span re-scales the
// distance fed to that curve so one can fall off faster or slower than the
// others. smoothstep between knots keeps slope continuous where a linear
// lookup kinked at every integer distance
type Curve = { knots: number[]; span: number };

const SIZE: Curve = { knots: [260, 200, 158, 126], span: 3 };
// horizontal spread, as a percentage of the distance from the flow origin to the
// screen edge. tuned by eye against SIZE and YAW: at these widths and this yaw each
// card lands well under its inner neighbour, so the fan reads as a stacked deck
const SPREAD: Curve = { knots: [0, 48.4, 76.5, 97.1], span: 3 };
const PUSH: Curve = { knots: [0, -140, -250, -330], span: 3 };
const YAW: Curve = { knots: [0, 45, 53, 58], span: 3 };
const DROP: Curve = { knots: [0, 8, 14, 18], span: 3 };
const FADE: Curve = { knots: [1, 0.95, 0.55, 0], span: 3 };
const FADE_CUTOFF = 2.9;

// grid mode: the same cards settle into slots, and rows past `rows` pan to keep
// the selection in view
const GRID_COLS = 4;
const GRID_ROWS = 3;
const GRID_SIZE = 112;
// gap between neighbouring slots; the pitch is what the grid actually steps by
const GRID_GUTTER = 16;

// the flow label hangs under the settled card, the grid label under the bottom
// row. the flow label carries the description line too, so it clears its card
// by the larger of the two
const FLOW_LABEL_GAP = 29;
const GRID_LABEL_GAP = -8;

// the mirror below a card is a slice of that same card, so the box inside the
// slice has to draw the card again at 100/crop of the slice's own height
const MIRROR_CROP_PCT = 42;

export const CARD_RADIUS = 24;

export const MIRROR = {
  // how much of the card's height the slice under it occupies
  slice: `${MIRROR_CROP_PCT}%`,
  plate: `${(10000 / MIRROR_CROP_PCT).toFixed(3)}%`,
};

export type Metrics = {
  width: number;
  height: number;
  cx: number;
  cy: number;
  perspective: number;
  cols: number;
  rows: number;
  gridSize: number;
  gridPitch: number;
  gridTop: number;
  labelWidth: number;
  labelYFlow: number;
  labelYGrid: number;
};

export function computeMetrics(width: number, height: number): Metrics {
  // above the vertical centre, leaving room under the settled card for its label
  const cy = Math.round(height * 0.427);
  // first row's top edge, clear of the top bar
  const gridTop = 125;
  const gridSize = GRID_SIZE;
  const gridPitch = gridSize + GRID_GUTTER;
  const labelWidth = 600;
  const perspective = 1100;
  // label under the settled flow card, or just below the bottom grid row;
  // both fall out of the geometry so retuning the cards moves the text
  const labelYFlow = cy + DROP.knots[0] + SIZE.knots[0] / 2 + FLOW_LABEL_GAP;
  const labelYGrid = gridTop + (GRID_ROWS - 1) * gridPitch + gridSize / 2 + GRID_LABEL_GAP;
  return {
    width,
    height,
    cx: width / 2,
    cy,
    perspective,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    gridSize,
    gridPitch,
    gridTop,
    labelWidth,
    labelYFlow,
    labelYGrid,
  };
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function curve(c: Curve, distance: number): number {
  const x = clamp(distance / c.span, 0, 1) * (c.knots.length - 1);
  const i = Math.min(Math.floor(x), c.knots.length - 2);
  const s = x - i;
  const eased = s * s * (3 - 2 * s);
  return c.knots[i] + (c.knots[i + 1] - c.knots[i]) * eased;
}

export type Layout = {
  x: number;
  y: number;
  z: number;
  size: number;
  yaw: number;
  opacity: number;
  zIndex: number;
};

export function flowLayout(offset: number, m: Metrics): Layout {
  const distance = Math.abs(offset);
  const dir = Math.sign(offset);
  return {
    x: (dir * curve(SPREAD, distance) * m.cx) / 100,
    y: curve(DROP, distance),
    z: curve(PUSH, distance),
    size: curve(SIZE, distance),
    yaw: -dir * curve(YAW, distance),
    opacity: distance > FADE_CUTOFF ? 0 : curve(FADE, distance),
    zIndex: 30 - Math.round(distance * 8),
  };
}

export function gridLayout(index: number, scroll: number, selected: boolean, m: Metrics): Layout {
  const col = index % m.cols;
  const row = Math.floor(index / m.cols);
  return {
    x: (col - (m.cols - 1) / 2) * m.gridPitch,
    y: m.gridTop - m.cy + row * m.gridPitch - scroll,
    z: 0,
    size: m.gridSize,
    yaw: 0,
    opacity: 1,
    // grid cells need no depth ordering, so stacking is a plain boolean
    zIndex: selected ? 2 : 1,
  };
}

export function interpolateLayout(flow: Layout, grid: Layout, mode: number): Layout {
  // the mode spring is underdamped and overshoots; geometry clamps so the
  // cards never extrapolate past the grid slots
  const t = clamp(mode, 0, 1);
  return {
    x: lerp(flow.x, grid.x, t),
    y: lerp(flow.y, grid.y, t),
    z: flow.z * (1 - t),
    size: lerp(flow.size, grid.size, t),
    yaw: flow.yaw * (1 - t),
    opacity: lerp(flow.opacity, grid.opacity, t),
    zIndex: t < 0.5 ? flow.zIndex : grid.zIndex,
  };
}
