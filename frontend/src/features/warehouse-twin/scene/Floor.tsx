import { useEffect, useMemo } from 'react'
import { MeshReflectorMaterial } from '@react-three/drei'
import type { WarehouseLayout } from '../data/schemas'
import type { QualityTier } from '../store/twinStore'
import { rectCenter, rectD, rectW, type SitePlan } from '../world/sitePlan'
import { createConcreteTextures, createFloorMarkingsTexture } from './textures'

interface FloorProps {
  layout: WarehouseLayout
  plan: SitePlan
  tier: QualityTier
  seed: number
}

/** Polished concrete slab with painted markings. Reflections on the High tier only. */
export function Floor({ layout, plan, tier, seed }: FloorProps) {
  const fp = plan.footprint
  const [cx, cz] = rectCenter(fp)
  const W = rectW(fp)
  const D = rectD(fp)

  const concrete = useMemo(() => createConcreteTextures(seed, [W / 8, D / 8]), [seed, W, D])
  const markings = useMemo(() => createFloorMarkingsTexture(layout, plan), [layout, plan])
  useEffect(() => () => {
    concrete.map.dispose()
    concrete.roughnessMap.dispose()
    markings.dispose()
  }, [concrete, markings])

  return (
    <group>
      <mesh position={[cx, 0, cz]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[W, D]} />
        {tier === 'high' ? (
          <MeshReflectorMaterial
            map={concrete.map}
            roughnessMap={concrete.roughnessMap}
            roughness={0.55}
            metalness={0.05}
            blur={[400, 120]}
            resolution={1024}
            mixBlur={1}
            mixStrength={0.55}
            mirror={0.35}
            depthScale={0.8}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
          />
        ) : (
          <meshStandardMaterial map={concrete.map} roughnessMap={concrete.roughnessMap} roughness={0.62} metalness={0.05} envMapIntensity={0.9} />
        )}
      </mesh>
      <mesh position={[cx, 0.004, cz]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={markings} transparent depthWrite={false} roughness={0.5} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  )
}
