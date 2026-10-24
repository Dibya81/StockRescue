import * as THREE from 'three'

// Per-frame world state shared between scene components without React
// re-renders: where moving entities are (for the follow camera and for
// people riding equipment) and counters for the dev hook.

export interface Mount {
  position: THREE.Vector3
  heading: number
  /** Height of the operator's floor/seat above the ground plane of the unit */
  floorY: number
  kind: 'seat' | 'platform' | 'behind'
  travelled: number
}

/** id → current world position (equipment, trucks, workers) */
export const entityPositions = new Map<string, THREE.Vector3>()

/** equipment id → where its operator sits or walks */
export const mounts = new Map<string, Mount>()

export const sceneStats = {
  ghosts: 0,
  solidActions: 0,
  workers: 0,
  trucks: 0,
  activeEquipment: 0,
  delayBeacons: 0,
  shortageMarkers: 0,
}

export function setEntityPosition(id: string, x: number, y: number, z: number) {
  const v = entityPositions.get(id)
  if (v) v.set(x, y, z)
  else entityPositions.set(id, new THREE.Vector3(x, y, z))
}
