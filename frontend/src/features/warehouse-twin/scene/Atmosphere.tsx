import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment, Lightformer, Sky } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import type { QualityTier } from '../store/twinStore'
import { rectCenter, rectD, rectW, type SitePlan } from '../world/sitePlan'

export interface TierSettings {
  dpr: [number, number]
  shadowMapSize: number
  ao: boolean
  aoHalfRes: boolean
  bloom: boolean
  smaa: boolean
}

export const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  low:    { dpr: [0.75, 1],   shadowMapSize: 1024, ao: false, aoHalfRes: true,  bloom: false, smaa: false },
  medium: { dpr: [1, 1.5],    shadowMapSize: 2048, ao: true,  aoHalfRes: true,  bloom: true,  smaa: true },
  high:   { dpr: [1, 2],      shadowMapSize: 4096, ao: true,  aoHalfRes: false, bloom: true,  smaa: true },
}

// Afternoon sun from the south-west: the dock facade is lit, the east face
// falls into shade, and shadows land on the yard the default views look at
const SUN_DIR = new THREE.Vector3(-0.55, 0.72, 0.42).normalize()

export function Atmosphere({ plan, tier }: { plan: SitePlan; tier: QualityTier }) {
  const settings = TIER_SETTINGS[tier]
  const site = plan.site
  const [cx, cz] = rectCenter(site)
  const half = Math.max(rectW(site), rectD(site)) / 2 + 10
  const sunPos = useMemo(() => SUN_DIR.clone().multiplyScalar(220).add(new THREE.Vector3(cx, 0, cz)), [cx, cz])

  return (
    <>
      <color attach="background" args={['#DCE6F0']} />
      <fog attach="fog" args={['#DCE5EE', 380, 1100]} />
      <Sky distance={1800} sunPosition={SUN_DIR.toArray()} turbidity={4} rayleigh={1.6} mieCoefficient={0.004} mieDirectionalG={0.8} />

      <hemisphereLight args={['#E4EEFF', '#6F7883', 0.45]} />
      <directionalLight
        position={sunPos}
        intensity={3.2}
        color="#FFF3E2"
        castShadow
        shadow-mapSize={[settings.shadowMapSize, settings.shadowMapSize]}
        shadow-radius={3}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
        shadow-camera-left={-half}
        shadow-camera-right={half}
        shadow-camera-top={half}
        shadow-camera-bottom={-half}
        shadow-camera-near={20}
        shadow-camera-far={520}
      >
        <object3D attach="target" position={[cx, 0, cz]} />
      </directionalLight>
      {/* Interior fill standing in for skylight bounce and LED high-bays (no shadows) */}
      <directionalLight position={[0, 60, 10]} intensity={0.7} color="#F2F6FF" />

      {/* Reflections and soft fill only; kept low so the sun's shadows read */}
      <Environment resolution={256} frames={1} background={false} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={2.2} color="#FFFFFF" position={[0, 40, 0]} rotation-x={Math.PI / 2} scale={[120, 80, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#DCE8FF" position={[0, 12, 80]} scale={[160, 24, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#FFF1DE" position={[-90, 14, 0]} rotation-y={Math.PI / 2} scale={[120, 20, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#E8EEF6" position={[90, 14, 0]} rotation-y={-Math.PI / 2} scale={[120, 20, 1]} />
      </Environment>

      {tier !== 'low' && <Effects settings={settings} />}
    </>
  )
}

function Effects({ settings }: { settings: TierSettings }) {
  const gl = useThree(s => s.gl)
  // The composer tone-maps at the end, so the renderer must not do it first
  useEffect(() => {
    const prev = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    return () => {
      gl.toneMapping = prev
    }
  }, [gl])

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={1.6} distanceFalloff={0.8} intensity={2.2} halfRes={settings.aoHalfRes} quality={settings.aoHalfRes ? 'performance' : 'medium'} />
      {/* Threshold sits above any sunlit diffuse surface: only emissive fixtures (toneMapped=false, intensity > 3) bloom */}
      <Bloom luminanceThreshold={2.8} luminanceSmoothing={0.3} intensity={0.7} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {settings.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  )
}
