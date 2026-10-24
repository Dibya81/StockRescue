import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Environment, Lightformer, Sky } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import { useTwinStore, type QualityTier, type TimeOfDay, type Weather } from '../store/twinStore'
import { GROUND_Y } from '../world/constants'
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

interface Look {
  sun: THREE.Vector3
  sunIntensity: number
  sunColor: string
  sky: { turbidity: number; rayleigh: number } | null
  background: string
  hemi: [string, string, number]
  fill: [string, number]
  env: number
  fog: [string, number, number]
  bloom: number
  floodlights: boolean
}

// Afternoon sun from the south-west: the dock facade is lit, the east face
// falls into shade, and shadows land on the yard the default views look at
const LOOKS: Record<TimeOfDay, Look> = {
  day: {
    sun: new THREE.Vector3(-0.55, 0.72, 0.42).normalize(), sunIntensity: 3.2, sunColor: '#FFF3E2',
    sky: { turbidity: 4, rayleigh: 1.6 }, background: '#DCE6F0',
    hemi: ['#E4EEFF', '#6F7883', 0.45], fill: ['#F2F6FF', 0.7], env: 0.55, fog: ['#DCE5EE', 380, 1100], bloom: 0.7, floodlights: false,
  },
  golden: {
    sun: new THREE.Vector3(-0.82, 0.2, 0.52).normalize(), sunIntensity: 2.6, sunColor: '#FFB46B',
    sky: { turbidity: 8, rayleigh: 3 }, background: '#F2D3B0',
    hemi: ['#FFD9B0', '#4E4440', 0.38], fill: ['#FFE2C2', 0.5], env: 0.4, fog: ['#EBD2BA', 320, 1000], bloom: 0.9, floodlights: false,
  },
  night: {
    sun: new THREE.Vector3(0.35, 0.8, -0.45).normalize(), sunIntensity: 0.22, sunColor: '#9DB4FF',
    sky: null, background: '#0B1222',
    // The fill stands in for the interior LED high-bays at night
    hemi: ['#22305A', '#07090F', 0.16], fill: ['#FFF1D8', 0.55], env: 0.12, fog: ['#0B1222', 220, 760], bloom: 1.25, floodlights: true,
  },
}

function applyWeather(look: Look, weather: Weather): Look {
  if (weather === 'rain') {
    return {
      ...look,
      sunIntensity: look.sunIntensity * 0.35,
      sky: look.sky ? { turbidity: 18, rayleigh: 0.6 } : null,
      background: look.sky ? '#A9B3BD' : look.background,
      hemi: [look.sky ? '#B8C2CC' : look.hemi[0], look.hemi[1], look.hemi[2] * 1.1],
      fog: [look.sky ? '#A9B3BD' : look.fog[0], 120, 520],
    }
  }
  if (weather === 'fog') {
    return { ...look, sunIntensity: look.sunIntensity * 0.5, fog: [look.sky ? '#C9CFD6' : '#151C2A', 25, 190], background: look.sky ? '#C9CFD6' : look.background }
  }
  return look
}

export function Atmosphere({ plan, tier }: { plan: SitePlan; tier: QualityTier }) {
  const settings = TIER_SETTINGS[tier]
  const timeOfDay = useTwinStore(s => s.timeOfDay)
  const weather = useTwinStore(s => s.weather)
  const look = applyWeather(LOOKS[timeOfDay], weather)
  const site = plan.site
  const [cx, cz] = rectCenter(site)
  const half = Math.max(rectW(site), rectD(site)) / 2 + 10
  const sunPos = useMemo(() => look.sun.clone().multiplyScalar(220).add(new THREE.Vector3(cx, 0, cz)), [look.sun, cx, cz])

  return (
    <>
      <color attach="background" args={[look.background]} />
      <fog attach="fog" args={look.fog} />
      {look.sky && <Sky distance={1800} sunPosition={look.sun.toArray()} turbidity={look.sky.turbidity} rayleigh={look.sky.rayleigh} mieCoefficient={0.004} mieDirectionalG={0.8} />}

      <hemisphereLight args={look.hemi} />
      <directionalLight
        position={sunPos}
        intensity={look.sunIntensity}
        color={look.sunColor}
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
      <directionalLight position={[0, 60, 10]} intensity={look.fill[1]} color={look.fill[0]} />
      {look.floodlights && plan.lightPoles.slice(0, 4).map((p, i) => (
        <pointLight key={i} position={[p.x, GROUND_Y + 8.6, p.z]} intensity={90} distance={36} decay={2} color="#FFE7C2" />
      ))}

      {/* Reflections and soft fill only; kept low so the sun's shadows read */}
      <Environment resolution={256} frames={1} background={false} environmentIntensity={look.env}>
        <Lightformer form="rect" intensity={2.2} color="#FFFFFF" position={[0, 40, 0]} rotation-x={Math.PI / 2} scale={[120, 80, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#DCE8FF" position={[0, 12, 80]} scale={[160, 24, 1]} />
        <Lightformer form="rect" intensity={0.8} color="#FFF1DE" position={[-90, 14, 0]} rotation-y={Math.PI / 2} scale={[120, 20, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#E8EEF6" position={[90, 14, 0]} rotation-y={-Math.PI / 2} scale={[120, 20, 1]} />
      </Environment>

      {tier !== 'low' && <Effects settings={settings} bloom={look.bloom} />}
    </>
  )
}

function Effects({ settings, bloom }: { settings: TierSettings; bloom: number }) {
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
      <Bloom luminanceThreshold={2.8} luminanceSmoothing={0.3} intensity={bloom} mipmapBlur />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      {settings.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  )
}
