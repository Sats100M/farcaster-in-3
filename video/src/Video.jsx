// 43 s vertical teaser. Every command and every line of output below is real:
// copied from the tutorial and from running it against the node on 2026-10-18/19.
import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';

const { fontFamily: sans } = loadInter('normal', { weights: ['400', '600', '700'], subsets: ['latin'] });
const { fontFamily: mono } = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] });

const INK = '#1d1d1f';
const GREY = '#6e6e73';
const BLUE = '#0066cc';
const GREEN = '#30d158';

const SCENES = [
  { from: 0, len: 90, el: <Intro /> },
  {
    from: 90, len: 210,
    el: <Step n="0" title="Rent a server" note="4 vCPU, 16 GB, 2 TB disk. Shows the price and asks before it creates anything."
      lines={[{ cmd: 'node scripts/provision.mjs --provider azure', at: 15 }]} />,
  },
  {
    from: 300, len: 270,
    el: <Step n="1" title="Run a Snapchain node" note="Your own copy of the network. No API keys."
      lines={[
        { cmd: 'curl -fsSL …/scripts/node.sh | sudo bash -s -- --fid 3355244', at: 15 },
        { cmd: 'fc-node-status', at: 110 },
        { out: 'version 0.14.3', at: 140 },
        { out: 'shard 0  height 48345235  behind 1s', at: 148 },
        { out: 'shard 1  height 49020486  behind 1s', at: 156 },
        { out: 'shard 2  height 48856015  behind 0s', at: 164 },
        { out: '✓ in sync', at: 180, ok: true },
      ]} />,
  },
  {
    from: 570, len: 300,
    el: <Step n="2" title="Your own client" note="It registers its own app key. Gasless, no wallet transaction."
      lines={[
        { cmd: 'node fc.mjs init --node 172.174.89.126', at: 15 },
        { out: 'Connected to node 172.174.89.126 (snapchain 0.14.3)', at: 60 },
        { out: 'Seed phrase (hidden): ', at: 75, dots: true },
        { out: '✓ App key 0x931335d7d936891e… is live.', at: 120, ok: true },
        { cmd: 'node fc.mjs cast "Sent from my own Farcaster node. No API keys. https://sats100m.github.io/farcaster-in-3/"', at: 150 },
        { out: '✓ Cast sent: 3355244/0xfdc3e931cdaa0d2b…', at: 240, ok: true },
      ]} />,
  },
  {
    from: 870, len: 210,
    el: <Step n="2" title="Filter by app" note="Every cast is signed by an app's key, so you can include or hide any client."
      lines={[
        { cmd: 'node fc.mjs apps balajis.eth', at: 15 },
        { out: 'Last 100 casts by @balajis.eth, by app:', at: 60 },
        { out: '    84  @warpcast (FID 9152)', at: 70 },
        { out: '    16  @baseapp.base.eth (FID 309857)', at: 78 },
        { cmd: 'node fc.mjs feed --hide-app 9152', at: 110 },
      ]} />,
  },
  { from: 1080, len: 210, el: <Outro /> },
];

export const DURATION = SCENES.at(-1).from + SCENES.at(-1).len;

export const Video = () => (
  <AbsoluteFill style={{ background: '#fff', fontFamily: sans, color: INK }}>
    {SCENES.map((s) => (
      <Sequence key={s.from} from={s.from} durationInFrames={s.len}>
        <Fade len={s.len}>{s.el}</Fade>
      </Sequence>
    ))}
  </AbsoluteFill>
);

function Fade({ len, children }) {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 10, len - 10, len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Rise({ delay = 0, children, style }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping: 200 } });
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, ...style }}>{children}</div>;
}

function Intro() {
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 90 }}>
      <Rise><div style={{ fontSize: 112, fontWeight: 700, letterSpacing: -4, lineHeight: 1.05 }}>Your own<br />Farcaster.</div></Rise>
      <Rise delay={22}><div style={{ fontSize: 112, fontWeight: 700, letterSpacing: -4, color: GREY, whiteSpace: 'nowrap', marginTop: 20 }}>Three commands.</div></Rise>
    </AbsoluteFill>
  );
}

function Step({ n, title, note, lines }) {
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 60px 120px' }}>
      <Rise>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{ width: 96, height: 96, borderRadius: 48, background: INK, color: '#fff', fontSize: 52, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{n}</div>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>{title}</div>
        </div>
      </Rise>
      <Rise delay={6} style={{ marginTop: 70 }}><Terminal lines={lines} /></Rise>
      <Rise delay={30} style={{ marginTop: 60 }}>
        <div style={{ fontSize: 48, lineHeight: 1.3, color: GREY, fontWeight: 400 }}>{note}</div>
      </Rise>
    </AbsoluteFill>
  );
}

const CHARS_PER_FRAME = 1.6;

function Terminal({ lines }) {
  const f = useCurrentFrame();
  return (
    <div style={{ background: '#1d1d1f', borderRadius: 32, padding: '34px 40px 44px', boxShadow: '0 30px 80px rgba(0,0,0,.18)', minHeight: 560 }}>
      <div style={{ display: 'flex', gap: 14, marginBottom: 34 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 22, height: 22, borderRadius: 11, background: c }} />)}
      </div>
      <div style={{ fontFamily: mono, fontSize: 31, lineHeight: 1.5, color: '#f5f5f7', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {lines.map((l, i) => {
          if (f < l.at) return null;
          if (l.cmd) {
            const shown = Math.min(l.cmd.length, Math.floor((f - l.at) * CHARS_PER_FRAME));
            const typing = shown < l.cmd.length;
            const last = !lines.slice(i + 1).some((x) => f >= x.at);
            return (
              <div key={i} style={{ marginTop: i ? 18 : 0 }}>
                <span style={{ color: GREEN }}>$ </span>{noBreakAfterHyphen(l.cmd.slice(0, shown))}
                {last && (typing || Math.floor(f / 15) % 2 === 0) && <span style={{ background: '#f5f5f7' }}> </span>}
              </div>
            );
          }
          const dots = l.dots ? '•'.repeat(Math.min(12, Math.floor((f - l.at) / 2))) : '';
          return <div key={i} style={{ color: l.ok ? GREEN : '#a1a1a6' }}>{l.out}{dots}</div>;
        })}
      </div>
    </div>
  );
}

// Keep flags like `--fid` and `-fsSL` from splitting across lines.
const noBreakAfterHyphen = (s) => s.replace(/-/g, '-⁠');

function Outro() {
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: 90 }}>
      <Rise><div style={{ fontSize: 104, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05 }}>No API keys.<br />No permission.</div></Rise>
      <Rise delay={18} style={{ marginTop: 60 }}>
        <div style={{ fontSize: 46, color: GREY, lineHeight: 1.5 }}>Read node · gasless app key · MIT<br />4 fixes sent upstream</div>
      </Rise>
      <Rise delay={36} style={{ marginTop: 90 }}>
        <div style={{ fontSize: 50, color: BLUE, fontWeight: 600 }}>sats100m.github.io/farcaster-in-3</div>
        <div style={{ fontSize: 42, color: GREY, marginTop: 16 }}>@sats100m</div>
      </Rise>
    </AbsoluteFill>
  );
}
