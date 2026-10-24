// World scale: 1 unit = 1 metre. The warehouse floor slab is y = 0;
// the yard sits one dock-height lower so truck beds meet the dock edge.

export const GROUND_Y = -1.2
export const LEVEL_BASE_Y = 0.15
export const WALL_THICKNESS = 0.3
export const TRUSS_DEPTH = 1.6
export const PARAPET_HEIGHT = 0.9
export const COLUMN_SPACING = 12
export const COLUMN_SIZE = 0.45
export const TRUSS_SPACING = 6

export const DOCK_DOOR = { width: 3.0, height: 3.4 } as const
export const PERSONNEL_DOOR = { width: 2.0, height: 2.5 } as const
export const EXIT_DOOR = { width: 1.0, height: 2.2 } as const

export const PALLET = { width: 1.2, depth: 1.0, height: 0.15 } as const
export const WALKWAY_WIDTH = 1.2
export const APRON_DEPTH = 36
export const EYE_HEIGHT = 1.7

export const BRAND_BLUE = '#1F4FD8'
export const SAFETY_YELLOW = '#F2C200'
