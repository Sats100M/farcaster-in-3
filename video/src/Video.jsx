// The story of building farcaster-in-3, in under a minute.
// Timing comes from src/timeline.json (written by scripts/gen_audio.py from the
// voiceover lengths). Every error, number and line of output shown is real.
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

// ---------------------------------------------------------------------------

export const Video = () => {
  const f = useCurrentFrame();
  const light = interpolate(f, [fr(BRIGHT_FROM), fr(BRIGHT_FROM) + 8], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ background: mix(C.night, C.paper, light), fontFamily: sans }}>
      {AUDIO && <Audio src={staticFile('music.wav')} volume={musicVolume} />}
      {timeline.scenes.map((s) => {
        const Scene = SCENES[s.id];
        return (
          <Sequence key={s.id} from={fr(s.start)} durationInFrames={fr(s.dur) + 6}>
            {AUDIO && <Audio src={staticFile(`vo_${s.id}.mp3`)} />}
            <Scene dur={fr(s.dur)} vo={fr(s.vo)} />
          </Sequence>
        );
      })}
      <Captions />
      <Progress />
    </AbsoluteFill>
  );
};

// Music sits under the voice: down while someone is talking, up in the gaps.
function musicVolume(f) {
  const talking = timeline.scenes.some((s) => f >= fr(s.start) - 4 && f <= fr(s.start + s.vo) + 4);
  return talking ? 0.2 : 0.6;
}

function mix(a, b, p) {
  const h = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [h(a), h(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * p)).join(',')})`;
}


function Pop({ at = 0, y = 50, children, style }) {
  const f = useCurrentFrame();
  const p = spring({ frame: f - at, fps: FPS, config: { damping: 18, mass: 0.6 } });
  return <div style={{ opacity: Math.min(1, p * 1.5), transform: `translateY(${(1 - p) * y}px) scale(${0.96 + 0.04 * p})`, ...style }}>{children}</div>;
}

function Center({ children, style }) {
  return <AbsoluteFill style={{ justifyContent: 'center', padding: '0 80px 260px', ...style }}>{children}</AbsoluteFill>;
}

const num = (n) => Math.round(n).toLocaleString('en-US');

// ---------------------------------------------------------------------------
// Scenes, in story order

const SCENES = {
  bounty() {
    const f = useCurrentFrame();
    const amount = interpolate(f, [8, 48], [0, 2048], { ...clamp, easing: Easing.out(Easing.cubic) });
    return (
      <Center>
        <Pop at={2}><div style={{ color: C.grey, fontSize: 44, fontWeight: 600 }}>balajis.eth · Saturday</div></Pop>
        <Pop at={8}><div style={{ color: '#fff', fontSize: 260, fontWeight: 800, letterSpacing: -10, lineHeight: 1 }}>${num(amount)}</div></Pop>
        <Pop at={30}><div style={{ color: '#fff', fontSize: 58, fontWeight: 700, letterSpacing: 6, marginTop: 20 }}>FOR FARCASTER CLIENTS</div></Pop>
      </Center>
    );
  },

  rules({ vo }) {
    const lines = [
      { t: 'Run your own Farcaster.', at: 0.18 },
      { t: 'No API keys.', at: 0.62, accent: true },
      { t: 'No permission.', at: 0.8, accent: true },
    ];
    return (
      <Center>
        {lines.map((l) => (
          <React.Fragment key={l.t}>
            <Pop at={Math.round(vo * l.at)}>
              <div style={{ color: l.accent ? '#fff' : C.grey, fontSize: l.accent ? 120 : 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.1, marginBottom: 24 }}>{l.t}</div>
            </Pop>
          </React.Fragment>
        ))}
      </Center>
    );
  },

  tried() {
    const f = useCurrentFrame();
    return (
      <Center style={{ alignItems: 'center' }}>
        <div style={{ color: '#fff', fontSize: 150, fontWeight: 800, letterSpacing: -5, transform: `scale(${1 + f * 0.002})` }}>
          So I tried.<span style={{ opacity: Math.floor(f / 8) % 2 ? 0 : 1, color: C.blue }}>_</span>
        </div>
      </Center>
    );
  },

  blocked({ vo }) {
    const f = useCurrentFrame();
    const hits = [
      { at: Math.round(vo * 0.02), who: 'Hetzner', msg: '403 resource_limit_exceeded' },
      { at: Math.round(vo * 0.2), who: 'AWS', msg: 'explicit deny in a service control policy' },
      { at: Math.round(vo * 0.42), who: 'Azure · D4s_v5', msg: 'SkuNotAvailable' },
      { at: Math.round(vo * 0.56), who: 'Azure · D4as_v5', msg: 'SkuNotAvailable' },
      { at: Math.round(vo * 0.86), who: 'Azure · D4s_v4', msg: 'running', ok: true },
    ];
    const lastErr = Math.max(...hits.filter((h) => !h.ok && f >= h.at).map((h) => h.at), -100);
    const shake = Math.sin(f * 2.7) * 16 * Math.exp(-(f - lastErr) / 4);
    const flash = Math.exp(-(f - lastErr) / 5) * 0.25;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ background: C.red, opacity: flash }} />
        <Center style={{ transform: `translateX(${shake}px)` }}>
          {hits.map((h) => (
            <React.Fragment key={h.who}>
              {f >= h.at && (
                <Pop at={h.at} y={30} style={{ marginBottom: 26 }}>
                  <div style={{ background: '#1c1c1e', border: `2px solid ${h.ok ? C.green : C.red}`, borderRadius: 28, padding: '28px 36px', display: 'flex', gap: 28, alignItems: 'center' }}>
                    <div style={{ fontSize: 56, color: h.ok ? C.green : C.red, fontWeight: 800, width: 50 }}>{h.ok ? '✓' : '✕'}</div>
                    <div>
                      <div style={{ color: '#fff', fontSize: 46, fontWeight: 700 }}>{h.who}</div>
                      <div style={{ color: h.ok ? C.green : '#ff8a80', fontFamily: mono, fontSize: 32, marginTop: 6 }}>{h.msg}</div>
                    </div>
                  </div>
                </Pop>
              )}
            </React.Fragment>
          ))}
        </Center>
      </AbsoluteFill>
    );
  },

  download({ vo }) {
    const f = useCurrentFrame();
    const p = interpolate(f, [6, vo], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
    return (
      <Center>
        <Pop at={0}><div style={{ color: C.grey, fontSize: 44, fontWeight: 600, marginBottom: 30 }}>Downloading the network</div></Pop>
        <div style={{ color: '#fff', fontSize: 200, fontWeight: 800, letterSpacing: -8, lineHeight: 1 }}>{num(470 * p)} GB</div>
        <div style={{ height: 22, background: '#2c2c2e', borderRadius: 11, marginTop: 50, overflow: 'hidden' }}>
          <div style={{ width: `${p * 100}%`, height: '100%', background: C.blue, borderRadius: 11 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26, fontFamily: mono, fontSize: 34, color: C.grey }}>
          <span>{num(5689 * p)} / 5,689 chunks</span>
          <span>{(11 * p).toFixed(1)} h</span>
        </div>
      </Center>
    );
  },

  behind({ vo }) {
    const f = useCurrentFrame();
    const land = Math.round(vo * 0.55);
    const s = interpolate(f, [fr(0.8), land], [0, 49212912], { ...clamp, easing: Easing.in(Easing.cubic) });
    const pulse = f >= land ? 0.18 * Math.exp(-(f - land) / 10) : 0;
    return (
      <AbsoluteFill>
        <AbsoluteFill style={{ background: `radial-gradient(circle, transparent 40%, ${C.red})`, opacity: f >= land ? 0.35 + pulse : 0 }} />
        <Center>
          <Shard n={1} behind="4s" ok />
          <Shard n={2} behind="0s" ok />
          <div style={{ marginTop: 60, color: C.grey, fontSize: 46, fontWeight: 600, fontFamily: mono }}>shard 0 behind</div>
          <div style={{ color: C.red, fontSize: 150, fontWeight: 800, letterSpacing: -5, lineHeight: 1.05 }}>{num(s)}s</div>
          {f >= land && <Pop at={land}><div style={{ color: '#fff', fontSize: 84, fontWeight: 800 }}>≈ 570 days</div></Pop>}
        </Center>
      </AbsoluteFill>
    );
  },

  fix({ vo }) {
    const prAt = Math.round(vo * 0.55);
    return (
      <Center>
        <Terminal dark lines={[
          { cmd: 'reload-shard.sh --shard 0', at: 6 },
          { out: '✓ all 371 chunks verified', at: 40, ok: true },
          { out: '✓ shard 0 reloaded', at: 52, ok: true },
        ]} />
        <Pop at={prAt} style={{ marginTop: 50 }}>
          <div style={{ background: '#1c1c1e', borderRadius: 28, padding: '34px 38px', border: '2px solid #3a3a3c' }}>
            <div style={{ color: C.grey, fontSize: 34, fontFamily: mono }}>farcasterxyz/snapchain  #1045</div>
            <div style={{ color: '#fff', fontSize: 44, fontWeight: 700, marginTop: 14, lineHeight: 1.25 }}>fix: refetch shard snapshot metadata right before downloading it</div>
            <div style={{ display: 'inline-block', marginTop: 22, background: C.green, color: '#000', borderRadius: 30, padding: '8px 26px', fontSize: 32, fontWeight: 700 }}>Open</div>
          </div>
        </Pop>
      </Center>
    );
  },

  sync({ vo }) {
    const f = useCurrentFrame();
    const doneAt = Math.round(vo * 0.8);
    const s = interpolate(f, [4, doneAt], [30821, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const done = f >= doneAt;
    return (
      <Center>
        <Shard n={1} behind="1s" ok light />
        <Shard n={2} behind="0s" ok light />
        <div style={{ marginTop: 60, color: C.grey, fontSize: 46, fontWeight: 600, fontFamily: mono }}>shard 0 behind</div>
        <div style={{ color: done ? C.green : C.ink, fontSize: 150, fontWeight: 800, letterSpacing: -5, lineHeight: 1.05 }}>{num(s)}s</div>
        {done && <Pop at={doneAt}><div style={{ color: C.ink, fontSize: 84, fontWeight: 800 }}>✓ in sync</div></Pop>}
      </Center>
    );
  },

  key({ vo }) {
    return (
      <Center>
        <Terminal lines={[
          { cmd: 'node fc.mjs init --node 172.174.89.126', at: 4 },
          { out: 'Seed phrase (hidden): ', at: 36, dots: true },
          { out: '✓ App key 0x931335d7d936891e… is live.', at: Math.round(vo * 0.5), ok: true },
        ]} />
        <div style={{ display: 'flex', gap: 20, marginTop: 50, flexWrap: 'wrap' }}>
          {['No gas', 'No wallet transaction'].map((t, i) => (
            <Pop key={t} at={Math.round(vo * (0.68 + i * 0.14))}>
              <div style={{ background: '#f2f2f7', color: C.ink, borderRadius: 40, padding: '18px 34px', fontSize: 44, fontWeight: 700 }}>{t}</div>
            </Pop>
          ))}
        </div>
      </Center>
    );
  },

  cast() {
    const castAt = 58;
    const f = useCurrentFrame();
    const glow = f >= castAt ? Math.exp(-(f - castAt) / 18) : 0;
    return (
      <Center>
        <Terminal lines={[
          { cmd: 'node fc.mjs cast "Sent from my own Farcaster node. No API keys. https://sats100m.github.io/farcaster-in-3/"', at: 0, speed: 2.4 },
          { out: '✓ Cast sent: 3355244/0xfdc3e931…', at: castAt - 6, ok: true },
        ]} />
        {f >= castAt && (
          <Pop at={castAt} y={80} style={{ marginTop: 44 }}>
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
      </Center>
    );
  },

  end({ vo }) {
    return (
      <Center>
        <Pop at={0}><div style={{ color: C.ink, fontSize: 104, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05, whiteSpace: 'nowrap' }}>Three commands.</div></Pop>
        <Pop at={Math.round(vo * 0.3)}><div style={{ color: C.grey, fontSize: 104, fontWeight: 800, letterSpacing: -4, lineHeight: 1.05 }}>Your own Farcaster.</div></Pop>
        <Pop at={Math.round(vo * 0.6)} style={{ marginTop: 80 }}>
          <div style={{ color: C.blue, fontSize: 52, fontWeight: 700 }}>sats100m.github.io/farcaster-in-3</div>
          <div style={{ color: C.grey, fontSize: 40, marginTop: 14 }}>Open source · MIT · @sats100m</div>
          <div style={{ color: '#aeaeb2', fontSize: 26, marginTop: 40 }}>Music: Kevin MacLeod (incompetech.com), CC BY 4.0</div>
        </Pop>
        <Pop at={Math.round(vo * 0.85)} style={{ marginTop: 70 }}>
          <div style={{ display: 'inline-block', background: C.ink, color: '#fff', borderRadius: 60, padding: '26px 56px', fontSize: 56, fontWeight: 800 }}>Your turn.</div>
        </Pop>
      </Center>
    );
  },
};

// ---------------------------------------------------------------------------
// Pieces

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

// Word-by-word captions, for everyone watching with the sound off.
function Captions() {
  const f = useCurrentFrame();
  const s = timeline.scenes.find((x) => f >= fr(x.start) && f < fr(x.start + x.vo) + 6);
  if (!s) return null;
  const light = f >= fr(BRIGHT_FROM);
  const words = s.text.split(' ');
  const shown = Math.ceil(interpolate(f, [fr(s.start), fr(s.start + s.vo)], [1, words.length], clamp));
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '0 70px 300px' }}>
      <div style={{ fontSize: 50, lineHeight: 1.3, fontWeight: 700, color: light ? C.ink : '#fff', textAlign: 'center' }}>
        {words.map((w, i) => <span key={i} style={{ opacity: i < shown ? 1 : 0.25 }}>{w} </span>)}
      </div>
    </AbsoluteFill>
  );
}

function Progress() {
  const f = useCurrentFrame();
  const light = f >= fr(BRIGHT_FROM);
  return <div style={{ position: 'absolute', top: 0, left: 0, height: 8, width: `${(f / DURATION) * 100}%`, background: light ? C.ink : '#fff', opacity: 0.85 }} />;
}
