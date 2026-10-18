// The story of farcaster-in-3, in under a minute.
// Timing comes from src/timeline.json (written by scripts/gen_audio.py from the
// voiceover lengths). Every number, command and line of output shown is real.
import React from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, Easing, getInputProps } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import timeline from './timeline.json';

const { fontFamily: sans } = loadInter('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] });
const { fontFamily: mono } = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] });

// --props='{"audio":false}' renders picture only, for adding a music track in an editor.
const AUDIO = getInputProps().audio !== false;

const FPS = 30;
export const DURATION = Math.ceil(timeline.total * FPS);
const fr = (sec) => Math.round(sec * FPS);

const C = { ink: '#1d1d1f', grey: '#86868b', blue: '#0a84ff', green: '#30d158', red: '#ff453a', paper: '#ffffff', night: '#000000' };
const BRIGHT_FROM = timeline.scenes.find((s) => s.id === 'sync').start;
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const FADE = 7;

// Each scene owns [start, next start): no two scenes are ever on screen together.
const SPANS = timeline.scenes.map((s, i) => {
  const from = fr(s.start);
  const to = i + 1 < timeline.scenes.length ? fr(timeline.scenes[i + 1].start) : DURATION;
  return { ...s, from, len: to - from, voLen: fr(s.vo) };
});

// ---------------------------------------------------------------------------

export const Video = () => {
  const f = useCurrentFrame();
  const light = interpolate(f, [fr(BRIGHT_FROM), fr(BRIGHT_FROM) + FADE], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: mix(C.night, C.paper, light), fontFamily: sans }}>
      {AUDIO && <Audio src={staticFile('music.wav')} volume={musicVolume} />}
      {SPANS.map((s) => {
        const Scene = SCENES[s.id];
        return (
          <Sequence key={s.id} from={s.from} durationInFrames={s.len}>
            {AUDIO && <Audio src={staticFile(`vo_${s.id}.mp3`)} />}
            <Fade len={s.len}><Scene vo={s.voLen} len={s.len} /></Fade>
            <Caption text={s.text} vo={s.voLen} len={s.len} light={s.from >= fr(BRIGHT_FROM)} />
          </Sequence>
        );
      })}
      <Progress />
    </AbsoluteFill>
  );
};

// Music sits under the voice: down while he's talking, up in the gaps.
function musicVolume(f) {
  const talking = SPANS.some((s) => f >= s.from - 4 && f <= s.from + s.voLen + 4);
  return talking ? 0.2 : 0.6;
}

function mix(a, b, p) {
  const h = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [h(a), h(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * p)).join(',')})`;
}

function Fade({ len, children }) {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, FADE, len - FADE, len], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Pop({ at = 0, y = 50, children, style }) {
  const f = useCurrentFrame();
  const p = spring({ frame: f - at, fps: FPS, config: { damping: 18, mass: 0.6 } });
  return <div style={{ opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * y}px) scale(${0.96 + 0.04 * p})`, ...style }}>{children}</div>;
}

// Content lives above the caption band at the bottom of the frame.
function Stage({ children, style }) {
  return <AbsoluteFill style={{ justifyContent: 'center', padding: '120px 80px 520px', ...style }}>{children}</AbsoluteFill>;
}

const num = (n) => Math.round(n).toLocaleString('en-US');
const at = (vo, p) => Math.round(vo * p);

// ---------------------------------------------------------------------------
// Scenes, in story order

const SCENES = {
  bounty({ vo }) {
    const f = useCurrentFrame();
    const amount = interpolate(f, [at(vo, 0.45), at(vo, 0.9)], [0, 2048], { ...clamp, easing: Easing.out(Easing.cubic) });
    return (
      <Stage>
        <Pop at={2}><div style={{ color: C.grey, fontSize: 46, fontWeight: 600 }}>balajis.eth posted a bounty</div></Pop>
        <Pop at={at(vo, 0.42)}><div style={{ color: '#fff', fontSize: 250, fontWeight: 800, letterSpacing: -10, lineHeight: 1.05 }}>${num(amount)}</div></Pop>
        <Pop at={at(vo, 0.8)}><div style={{ color: '#fff', fontSize: 56, fontWeight: 700, letterSpacing: 6 }}>FOR FARCASTER CLIENTS</div></Pop>
      </Stage>
    );
  },

  rules({ vo }) {
    const lines = [
      { t: 'Run your own Farcaster.', p: 0.05, big: false },
      { t: 'No API keys.', p: 0.55, big: true },
      { t: 'No permission.', p: 0.78, big: true },
    ];
    return (
      <Stage>
        {lines.map((l) => (
          <Pop key={l.t} at={at(vo, l.p)}>
            <div style={{ color: l.big ? '#fff' : C.grey, fontSize: l.big ? 124 : 78, fontWeight: 800, letterSpacing: -3, lineHeight: 1.1, marginBottom: 24 }}>{l.t}</div>
          </Pop>
        ))}
      </Stage>
    );
  },

  network({ vo }) {
    return (
      <Stage style={{ alignItems: 'center' }}>
        <Network vo={vo} />
      </Stage>
    );
  },

  three({ vo }) {
    const steps = ['Rent a server', 'Run a node', 'Run a client'];
    return (
      <Stage>
        {steps.map((t, i) => (
          <Pop key={t} at={at(vo, 0.15 + i * 0.18)} style={{ marginBottom: 34 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
              <div style={{ width: 110, height: 110, borderRadius: 55, background: '#fff', color: '#000', fontSize: 58, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i}</div>
              <div style={{ color: '#fff', fontSize: 80, fontWeight: 800, letterSpacing: -2 }}>{t}</div>
            </div>
          </Pop>
        ))}
      </Stage>
    );
  },

  server({ vo }) {
    return (
      <Stage>
        <StepTitle n="0" title="Rent a server" dark />
        <Pop at={4} style={{ marginTop: 50 }}>
          <Terminal lines={[
            { cmd: 'node scripts/provision.mjs', at: 8 },
            { out: 'vm    4 vCPU, 16 GB RAM, Ubuntu 24.04', at: 36 },
            { out: 'disk  2048 GB Standard SSD', at: 44 },
            { out: 'Create it? [y/N] y', at: 58, ok: true },
          ]} />
        </Pop>
        <Pop at={at(vo, 0.6)} style={{ marginTop: 40 }}>
          <Chip dark>From about $6 a day. Delete it anytime.</Chip>
        </Pop>
      </Stage>
    );
  },

  node({ vo }) {
    const f = useCurrentFrame();
    const p = interpolate(f, [at(vo, 0.35), vo], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
    return (
      <Stage>
        <StepTitle n="1" title="Run your own node" dark />
        <div style={{ color: '#fff', fontSize: 190, fontWeight: 800, letterSpacing: -8, lineHeight: 1, marginTop: 70 }}>{num(470 * p)} GB</div>
        <div style={{ height: 22, background: '#2c2c2e', borderRadius: 11, marginTop: 44, overflow: 'hidden' }}>
          <div style={{ width: `${p * 100}%`, height: '100%', background: C.blue, borderRadius: 11 }} />
        </div>
        <div style={{ marginTop: 24, fontFamily: mono, fontSize: 34, color: C.grey }}>the entire network, on your server</div>
      </Stage>
    );
  },

  behind({ vo }) {
    const f = useCurrentFrame();
    const land = at(vo, 0.75);
    const s = interpolate(f, [6, land], [0, 49212912], { ...clamp, easing: Easing.in(Easing.cubic) });
    const hit = f >= land;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ background: `radial-gradient(circle, transparent 40%, ${C.red})`, opacity: hit ? 0.35 + 0.2 * Math.exp(-(f - land) / 10) : 0 }} />
        <Stage>
          <Shard n={1} behind="4s" ok />
          <Shard n={2} behind="0s" ok />
          <div style={{ marginTop: 60, color: C.grey, fontSize: 46, fontWeight: 600, fontFamily: mono }}>shard 0 behind</div>
          <div style={{ color: C.red, fontSize: 150, fontWeight: 800, letterSpacing: -5, lineHeight: 1.05 }}>{num(s)}s</div>
          <div style={{ height: 100 }}>
            {hit && <Pop at={land}><div style={{ color: '#fff', fontSize: 84, fontWeight: 800 }}>≈ 570 days</div></Pop>}
          </div>
        </Stage>
      </AbsoluteFill>
    );
  },

  fix({ vo }) {
    return (
      <Stage>
        <Pop at={2}>
          <Terminal dark lines={[{ cmd: 'reload-shard.sh --shard 0', at: 6 }, { out: '✓ shard 0 reloaded', at: 40, ok: true }]} />
        </Pop>
        <Pop at={at(vo, 0.55)} style={{ marginTop: 44 }}>
          <div style={{ background: '#1c1c1e', borderRadius: 28, padding: '34px 38px', border: '2px solid #3a3a3c' }}>
            <div style={{ color: C.grey, fontSize: 34, fontFamily: mono }}>farcasterxyz/snapchain  #1045</div>
            <div style={{ color: '#fff', fontSize: 44, fontWeight: 700, marginTop: 14, lineHeight: 1.25 }}>fix: refetch shard snapshot metadata right before downloading it</div>
          </div>
        </Pop>
      </Stage>
    );
  },

  sync({ vo }) {
    const f = useCurrentFrame();
    const doneAt = at(vo, 0.8);
    const s = interpolate(f, [4, doneAt], [30821, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const done = f >= doneAt;
    return (
      <Stage>
        <Shard n={1} behind="1s" ok light />
        <Shard n={2} behind="0s" ok light />
        <div style={{ marginTop: 60, color: C.grey, fontSize: 46, fontWeight: 600, fontFamily: mono }}>shard 0 behind</div>
        <div style={{ color: done ? C.green : C.ink, fontSize: 150, fontWeight: 800, letterSpacing: -5, lineHeight: 1.05 }}>{num(s)}s</div>
        <div style={{ height: 100 }}>
          {done && <Pop at={doneAt}><div style={{ color: C.ink, fontSize: 84, fontWeight: 800 }}>✓ in sync</div></Pop>}
        </div>
      </Stage>
    );
  },

  key({ vo }) {
    return (
      <Stage>
        <StepTitle n="2" title="Your own client" />
        <Pop at={4} style={{ marginTop: 50 }}>
          <Terminal lines={[
            { cmd: 'node fc.mjs init --node 172.174.89.126', at: 8 },
            { out: 'Seed phrase (hidden): ', at: 42, dots: true },
            { out: '✓ App key 0x931335d7d936891e… is live.', at: at(vo, 0.55), ok: true },
          ]} />
        </Pop>
        <Pop at={at(vo, 0.85)} style={{ marginTop: 40 }}><Chip>No gas. No wallet transaction.</Chip></Pop>
      </Stage>
    );
  },

  cast() {
    const castAt = 48;
    const f = useCurrentFrame();
    const glow = f >= castAt ? Math.exp(-(f - castAt) / 18) : 0;
    return (
      <Stage>
        <Terminal lines={[
          { cmd: 'node fc.mjs cast "Sent from my own Farcaster node. No API keys."', at: 0, speed: 2.4 },
          { out: '✓ Cast sent: 3355244/0xfdc3e931…', at: castAt - 8, ok: true },
        ]} />
        <div style={{ height: 380, marginTop: 44 }}>
          {f >= castAt && (
            <Pop at={castAt} y={80}>
              <div style={{ background: '#fff', borderRadius: 34, padding: '38px 40px', boxShadow: `0 30px 90px rgba(10,132,255,${0.15 + glow * 0.5})`, border: '1px solid #e5e5ea' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
                  <div style={{ width: 84, height: 84, borderRadius: 42, background: 'linear-gradient(135deg,#7c4dff,#0a84ff)', color: '#fff', fontSize: 44, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>S</div>
                  <div>
                    <div style={{ fontSize: 42, fontWeight: 700, color: C.ink }}>@sats100m</div>
                    <div style={{ fontSize: 32, color: C.grey }}>just now · from my own node</div>
                  </div>
                </div>
                <div style={{ fontSize: 50, color: C.ink, marginTop: 26, lineHeight: 1.3, fontWeight: 500 }}>Sent from my own Farcaster node. No API keys. <span style={{ color: C.blue }}>sats100m.github.io/farcaster-in-3</span></div>
              </div>
            </Pop>
          )}
        </div>
      </Stage>
    );
  },

  end({ vo }) {
    return (
      <Stage>
        <Pop at={0}><div style={{ color: C.ink, fontSize: 170, fontWeight: 800, letterSpacing: -7, lineHeight: 1 }}>Your turn.</div></Pop>
        <Pop at={at(vo, 0.3)} style={{ marginTop: 50 }}>
          <div style={{ color: C.grey, fontSize: 56, fontWeight: 700, lineHeight: 1.25 }}>Three commands.<br />Open source, step by step.</div>
        </Pop>
        <Pop at={at(vo, 0.65)} style={{ marginTop: 70 }}>
          <div style={{ display: 'inline-block', background: C.ink, color: '#fff', borderRadius: 60, padding: '26px 48px', fontSize: 44, fontWeight: 700 }}>sats100m.github.io/farcaster-in-3</div>
          <div style={{ color: '#aeaeb2', fontSize: 26, marginTop: 40 }}>Music: Kevin MacLeod (incompetech.com), CC BY 4.0</div>
        </Pop>
      </Stage>
    );
  },
};

// ---------------------------------------------------------------------------
// Pieces

// A small network: nodes appear, links draw in, then "you" joins.
const NODES = [[120, 160], [380, 80], [650, 150], [840, 330], [180, 430], [470, 330], [760, 560], [90, 690], [330, 610], [600, 760], [850, 820], [250, 860]];
const YOU = [470, 560];
const EDGES = NODES.flatMap((a, i) => NODES.slice(i + 1).map((b, j) => [i, i + 1 + j]))
  .filter(([i, j]) => Math.hypot(NODES[i][0] - NODES[j][0], NODES[i][1] - NODES[j][1]) < 330);

function Network({ vo }) {
  const f = useCurrentFrame();
  const youAt = at(vo, 0.62);
  const nearYou = NODES.map((n, i) => [i, Math.hypot(n[0] - YOU[0], n[1] - YOU[1])]).filter(([, d]) => d < 330).map(([i]) => i);
  const youP = spring({ frame: f - youAt, fps: FPS, config: { damping: 12 } });
  return (
    <svg width="940" height="940" viewBox="0 0 940 940">
      {EDGES.map(([i, j], k) => {
        const p = interpolate(f, [6 + k * 2, 20 + k * 2], [0, 1], clamp);
        const [a, b] = [NODES[i], NODES[j]];
        return <line key={k} x1={a[0]} y1={a[1]} x2={a[0] + (b[0] - a[0]) * p} y2={a[1] + (b[1] - a[1]) * p} stroke="#3a3a3c" strokeWidth="4" />;
      })}
      {nearYou.map((i) => {
        const p = interpolate(f, [youAt + 6, youAt + 20], [0, 1], clamp);
        const a = NODES[i];
        return <line key={`y${i}`} x1={YOU[0]} y1={YOU[1]} x2={YOU[0] + (a[0] - YOU[0]) * p} y2={YOU[1] + (a[1] - YOU[1]) * p} stroke={C.blue} strokeWidth="5" />;
      })}
      {NODES.map(([x, y], i) => {
        const p = spring({ frame: f - i * 2, fps: FPS, config: { damping: 14 } });
        return <circle key={i} cx={x} cy={y} r={22 * p} fill="#fff" />;
      })}
      {f >= youAt && (
        <g>
          <circle cx={YOU[0]} cy={YOU[1]} r={60 * youP} fill={C.blue} opacity={0.25} />
          <circle cx={YOU[0]} cy={YOU[1]} r={34 * youP} fill={C.blue} />
          <text x={YOU[0]} y={YOU[1] + 100} textAnchor="middle" fill="#fff" fontSize="48" fontWeight="800" fontFamily={sans} opacity={youP}>you</text>
        </g>
      )}
    </svg>
  );
}

function StepTitle({ n, title, dark }) {
  return (
    <Pop at={0}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ width: 96, height: 96, borderRadius: 48, background: dark ? '#fff' : C.ink, color: dark ? '#000' : '#fff', fontSize: 52, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</div>
        <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -2, color: dark ? '#fff' : C.ink }}>{title}</div>
      </div>
    </Pop>
  );
}

function Chip({ children, dark }) {
  return <div style={{ display: 'inline-block', background: dark ? '#1c1c1e' : '#f2f2f7', color: dark ? '#fff' : C.ink, borderRadius: 40, padding: '18px 34px', fontSize: 42, fontWeight: 700 }}>{children}</div>;
}

function Shard({ n, behind, ok, light }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: mono, fontSize: 44, color: light ? C.ink : '#fff', padding: '14px 0', borderBottom: `1px solid ${light ? '#e5e5ea' : '#2c2c2e'}` }}>
      <span>shard {n}</span>
      <span style={{ color: ok ? C.green : C.red }}>behind {behind}</span>
    </div>
  );
}

function Terminal({ lines, dark }) {
  const f = useCurrentFrame();
  return (
    <div style={{ background: dark ? '#1c1c1e' : '#1d1d1f', borderRadius: 32, padding: '32px 40px 40px', boxShadow: dark ? 'none' : '0 30px 80px rgba(0,0,0,.18)' }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 28 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 20, height: 20, borderRadius: 10, background: c }} />)}
      </div>
      <div style={{ fontFamily: mono, fontSize: 34, lineHeight: 1.5, color: '#f5f5f7', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {lines.map((l, i) => {
          if (f < l.at) return null;
          if (l.cmd) {
            const shown = Math.min(l.cmd.length, Math.floor((f - l.at) * (l.speed ?? 1.4)));
            const typing = shown < l.cmd.length;
            const last = !lines.slice(i + 1).some((x) => f >= x.at);
            return (
              <div key={i} style={{ marginTop: i ? 16 : 0 }}>
                <span style={{ color: C.green }}>$ </span>{l.cmd.slice(0, shown).replace(/-/g, '-⁠')}
                {last && (typing || Math.floor(f / 15) % 2 === 0) && <span style={{ background: '#f5f5f7' }}> </span>}
              </div>
            );
          }
          const dots = l.dots ? '•'.repeat(Math.min(16, Math.floor((f - l.at) / 2))) : '';
          return <div key={i} style={{ color: l.ok ? C.green : '#a1a1a6' }}>{l.out}{dots}</div>;
        })}
      </div>
    </div>
  );
}

// Word-by-word captions in a fixed band at the bottom, for sound-off viewers.
function Caption({ text, vo, len, light }) {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, FADE, Math.min(len, vo + 12) - FADE, Math.min(len, vo + 12)], [0, 1, 1, 0], clamp);
  const words = text.split(' ');
  const shown = Math.ceil(interpolate(f, [0, vo], [1, words.length], clamp));
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '0 70px 250px', opacity }}>
      <div style={{ height: 210, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ fontSize: 50, lineHeight: 1.3, fontWeight: 700, color: light ? C.ink : '#fff', textAlign: 'center' }}>
          {words.map((w, i) => <span key={i} style={{ opacity: i < shown ? 1 : 0.25 }}>{w} </span>)}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function Progress() {
  const f = useCurrentFrame();
  const light = f >= fr(BRIGHT_FROM);
  return <div style={{ position: 'absolute', top: 0, left: 0, height: 8, width: `${(f / DURATION) * 100}%`, background: light ? C.ink : '#fff', opacity: 0.85 }} />;
}
