import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import AiOrb from '../AiOrb.jsx';

/**
 * WebGL holographic core for the dashboard hero.
 *
 * Design notes:
 * - Everything is procedural geometry (no external assets, no model files touched).
 * - One canvas: a handful of shells, four orbit rings, three arc segments, a point
 *   field and a faded floor grid. Capped DPR keeps it cheap on laptops.
 * - The scene renders continuously, pauses when the tab is hidden, and freezes
 *   under prefers-reduced-motion. Falls back to the CSS orb without WebGL.
 */

const CYAN = '#43dcff';
const BLUE = '#4f8bff';
const VIOLET = '#9b8cff';
const ICE = '#d8f7ff';

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => {
      mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange);
    };
  }, []);
  return reduced;
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/** Soft radial sprite used as volumetric light. */
function useGlowTexture() {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(190,242,255,0.62)');
    g.addColorStop(0.55, 'rgba(79,139,255,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
}

/** Thin luminous orbit ring. */
function Ring({ radius, tube = 0.007, rotation, color, opacity = 0.55, spin = 0.12, paused }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current && !paused) ref.current.rotation.z += delta * spin;
  });
  return (
    <mesh ref={ref} rotation={rotation}>
      <torusGeometry args={[radius, tube, 6, 220]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Open arc segment — reads as a data path around the core. */
function Arc({ radius, length = Math.PI * 0.55, rotation, color, opacity = 0.7, spin = 0.16, paused }) {
  const ref = useRef();
  useFrame((_, delta) => {
    if (ref.current && !paused) ref.current.rotation.z += delta * spin;
  });
  return (
    <mesh ref={ref} rotation={rotation}>
      <torusGeometry args={[radius, 0.014, 6, 90, length]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** A node travelling along one of the orbits, with a soft halo. */
function Orbiter({ radius, speed, offset, size = 0.055, color = CYAN, tilt = [0, 0, 0], paused, texture }) {
  const ref = useRef();
  const halo = useRef();
  useFrame((state) => {
    if (!ref.current || paused) return;
    const t = state.clock.elapsedTime * speed + offset;
    ref.current.position.set(Math.cos(t) * radius, Math.sin(t) * radius, 0);
    if (halo.current) {
      halo.current.position.set(Math.cos(t) * radius, Math.sin(t) * radius, 0);
      const k = 1 + Math.sin(state.clock.elapsedTime * 2 + offset) * 0.12;
      halo.current.scale.setScalar(k);
    }
  });
  return (
    <group rotation={tilt}>
      <mesh ref={ref}>
        <sphereGeometry args={[size, 14, 14]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <sprite ref={halo} scale={[0.85, 0.85, 1]}>
        <spriteMaterial
          map={texture}
          color={color}
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>
    </group>
  );
}

/** Slow drifting particle field around the core. */
function ParticleField({ count = 900, paused, texture }) {
  const ref = useRef();
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const r = 2.2 + Math.pow(Math.random(), 0.7) * 3.4;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.cos(phi) * 0.82;
      arr[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta) * 0.75;
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (!ref.current || paused) return;
    ref.current.rotation.y += delta * 0.028;
    ref.current.rotation.x = Math.sin(performance.now() * 0.00005) * 0.07;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={texture}
        size={0.075}
        color="#8fe9ff"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/** Bright nodes on the core surface — reads as a neural lattice. */
function SurfaceNodes({ radius = 1.16, count = 260, paused, texture }) {
  const ref = useRef();
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = radius * Math.cos(phi);
      arr[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    return arr;
  }, [count, radius]);

  useFrame((_, delta) => {
    if (ref.current && !paused) ref.current.rotation.y += delta * 0.05;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={texture}
        size={0.075}
        color={ICE}
        transparent
        opacity={0.5}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/** Floating translucent holographic plates — depth without extra geometry cost. */
function Shards({ paused }) {
  const group = useRef();
  const plates = useMemo(() => ([
    { p: [-2.05, 1.25, -0.6], r: [0.1, -0.5, 0.28], s: [0.86, 0.02, 0.56], o: 0.1, c: CYAN },
    { p: [2.15, -1.05, -0.35], r: [-0.14, 0.6, -0.2], s: [0.72, 0.02, 0.46], o: 0.09, c: VIOLET },
    { p: [1.55, 1.55, 0.35], r: [0.24, 0.35, 0.1], s: [0.42, 0.02, 0.42], o: 0.08, c: BLUE },
    { p: [-1.7, -1.6, 0.5], r: [-0.2, -0.4, 0.34], s: [0.5, 0.02, 0.34], o: 0.07, c: ICE }
  ]), []);

  useFrame((state) => {
    if (!group.current || paused) return;
    const t = state.clock.elapsedTime;
    group.current.children.forEach((child, i) => {
      child.position.y = plates[i].p[1] + Math.sin(t * 0.32 + i * 1.7) * 0.09;
      child.rotation.z = plates[i].r[2] + Math.sin(t * 0.2 + i) * 0.05;
    });
  });

  return (
    <group ref={group}>
      {plates.map((pl, i) => (
        <mesh key={i} position={pl.p} rotation={pl.r} scale={pl.s}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color={pl.c}
            transparent
            opacity={pl.o}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Faded perspective floor — anchors the core in space. */
function FloorGrid() {
  const ref = useRef();
  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const mat = Array.isArray(grid.material) ? grid.material[0] : grid.material;
    if (mat) {
      mat.transparent = true;
      mat.opacity = 0.18;
      mat.depthWrite = false;
      mat.fog = true;
    }
  }, []);
  return (
    <gridHelper
      ref={ref}
      args={[64, 64, '#2b5f9e', '#163056']}
      position={[0, -2.45, -1.2]}
      rotation={[0, 0, 0]}
    />
  );
}

function Scene({ reduced, texture }) {
  const rig = useRef();
  const core = useRef();
  const shell = useRef();
  const inner = useRef();
  const aura = useRef();
  const pointer = useRef({ x: 0, y: 0 });

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    pointer.current.x += (state.pointer.x - pointer.current.x) * 0.04;
    pointer.current.y += (state.pointer.y - pointer.current.y) * 0.04;

    if (rig.current && !reduced) {
      rig.current.rotation.y = t * 0.06 + pointer.current.x * 0.26;
      rig.current.rotation.x = Math.sin(t * 0.15) * 0.045 - pointer.current.y * 0.16;
    }
    if (core.current && !reduced) {
      core.current.rotation.y = t * 0.1;
      core.current.scale.setScalar(1 + Math.sin(t * 0.8) * 0.018);
    }
    if (shell.current && !reduced) {
      shell.current.rotation.y = -t * 0.055;
      shell.current.rotation.z = Math.sin(t * 0.11) * 0.14;
    }
    if (inner.current && !reduced) {
      inner.current.rotation.x = t * 0.2;
      inner.current.rotation.z = t * 0.13;
    }
    if (aura.current) {
      const breathe = 0.9 + Math.sin(t * 0.7) * 0.06;
      aura.current.scale.setScalar(breathe);
    }
  });

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[4, 3.4, 5]} intensity={34} distance={20} decay={2} color={CYAN} />
      <pointLight position={[-4.6, -2.4, 3]} intensity={26} distance={20} decay={2} color={VIOLET} />
      <pointLight position={[0, 4.6, -3]} intensity={22} distance={18} decay={2} color={BLUE} />

      {/* Overall visual scale only — 0.88 trims the globe ~12% vs. its original
          size. Geometry, camera, lighting and animation stay as authored. */}
      <group ref={rig} rotation={[0.05, 0, 0]} scale={0.88}>
        {/* volumetric aura behind the core */}
        <sprite ref={aura} scale={[8.6, 8.6, 1]} position={[0, 0, -1.6]}>
          <spriteMaterial
            map={texture}
            color="#3f8cff"
            transparent
            opacity={0.24}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>

        {/* ionised core — dark, translucent, lit from inside so the
            lattice and nodes stay the reading surface */}
        <mesh ref={core}>
          <icosahedronGeometry args={[1.16, 6]} />
          <meshStandardMaterial
            color="#06132e"
            emissive="#1d4fbf"
            emissiveIntensity={0.34}
            metalness={0.82}
            roughness={0.26}
            transparent
            opacity={0.72}
          />
        </mesh>

        {/* inner energy mass */}
        <mesh scale={0.52}>
          <sphereGeometry args={[1.16, 32, 32]} />
          <meshBasicMaterial color="#9fe4ff" transparent opacity={0.16} toneMapped={false} />
        </mesh>

        {/* rim light: a slightly larger additive shell reads as a fresnel edge */}
        <mesh scale={1.1}>
          <sphereGeometry args={[1.16, 32, 32]} />
          <meshBasicMaterial
            color="#4aa8ff"
            transparent
            opacity={0.07}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <SurfaceNodes paused={reduced} texture={texture} />

        {/* inner lattice */}
        <mesh ref={inner} scale={1.005}>
          <icosahedronGeometry args={[1.16, 1]} />
          <meshBasicMaterial
            color="#bff4ff"
            wireframe
            transparent
            opacity={0.46}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/* inner gyroscope — reads as machinery inside the core */}
        <group rotation={[0.6, 0.3, 0]}>
          <Ring radius={0.62} tube={0.005} rotation={[Math.PI / 2, 0, 0]} color={ICE} opacity={0.5} spin={0.5} paused={reduced} />
          <Ring radius={0.78} tube={0.004} rotation={[0.4, Math.PI / 3, 0]} color={CYAN} opacity={0.42} spin={-0.38} paused={reduced} />
        </group>

        {/* singularity glow at the centre */}
        <sprite scale={[1.15, 1.15, 1]}>
          <spriteMaterial
            map={texture}
            color="#bfe9ff"
            transparent
            opacity={0.24}
            depthWrite={false}
            depthTest={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>

        {/* soft halo shell */}
        <mesh ref={shell} scale={1.33}>
          <icosahedronGeometry args={[1.16, 2]} />
          <meshBasicMaterial
            color="#8adaff"
            wireframe
            transparent
            opacity={0.15}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <Ring radius={1.62} rotation={[Math.PI / 2.35, 0.24, 0]} color={CYAN} opacity={0.5} spin={0.14} paused={reduced} />
        <Ring radius={2.0} rotation={[Math.PI / 1.72, -0.42, 0.4]} color={BLUE} opacity={0.36} spin={-0.1} paused={reduced} tube={0.005} />
        <Ring radius={2.34} rotation={[Math.PI / 2.9, 0.62, -0.3]} color={VIOLET} opacity={0.32} spin={0.08} paused={reduced} tube={0.004} />

        <Arc radius={1.84} rotation={[Math.PI / 2.1, 0.1, 0.9]} color={VIOLET} opacity={0.4} spin={-0.24} paused={reduced} />
        <Arc radius={2.2} length={Math.PI * 0.4} rotation={[Math.PI / 1.9, 0.5, -0.6]} color={CYAN} opacity={0.32} spin={0.18} paused={reduced} />
        <Arc radius={2.45} length={Math.PI * 0.3} rotation={[Math.PI / 2.6, -0.4, 0.2]} color={BLUE} opacity={0.26} spin={-0.14} paused={reduced} />

        <Orbiter radius={1.62} speed={0.5} offset={0.4} tilt={[Math.PI / 2.35, 0.24, 0]} paused={reduced} texture={texture} />
        <Orbiter radius={2.0} speed={-0.32} offset={2.1} color={VIOLET} size={0.05} tilt={[Math.PI / 1.72, -0.42, 0.4]} paused={reduced} texture={texture} />
        <Orbiter radius={2.34} speed={0.24} offset={4.2} color={ICE} size={0.042} tilt={[Math.PI / 2.9, 0.62, -0.3]} paused={reduced} texture={texture} />

        <Shards paused={reduced} />
        <ParticleField paused={reduced} texture={texture} />
      </group>

      <fog attach="fog" args={['#04070f', 9, 22]} />
      <FloorGrid />
    </>
  );
}

export default function NeuralCore({ connected = false }) {
  const reduced = usePrefersReducedMotion();
  const visible = useDocumentVisible();
  const [supported] = useState(webglAvailable);
  const [contextLost, setContextLost] = useState(false);
  const texture = useGlowTexture();

  // A lost WebGL context can paint the canvas as an opaque white rectangle on
  // weaker GPUs. Hide the surface immediately and hand over to the CSS orb so
  // the hero never turns into a blank block.
  const handleCreated = ({ gl }) => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      canvas.style.visibility = 'hidden';
      setContextLost(true);
    }, false);
  };

  if (!supported || contextLost) {
    return (
      <div className="neural-fallback">
        <AiOrb caption={connected ? 'ensemble · online' : 'inference · offline'} />
      </div>
    );
  }

  return (
    <div className={`neural-canvas${reduced ? ' is-static' : ''}`}>
      <Canvas
        dpr={[1, 1.7]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 0.55, 9.3], fov: 42 }}
        frameloop={visible ? 'always' : 'never'}
        onCreated={handleCreated}
      >
        <Scene reduced={reduced} texture={texture} />
      </Canvas>
    </div>
  );
}
