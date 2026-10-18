"""Generate the voiceover, music and sound effects, and the timeline the video follows.

    python scripts/gen_audio.py

Voice: Microsoft neural TTS through edge-tts (no key). Music and effects are
synthesized here with numpy, so there is nothing to license.
Writes public/*.wav|mp3 and src/timeline.json.
"""
import asyncio, json, subprocess, wave
from pathlib import Path

import numpy as np
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
PUB.mkdir(exist_ok=True)
SR = 44100
VOICE = "en-US-AndrewMultilingualNeural"

# id, narration, extra seconds of picture after the line ends
SCENES = [
    ("bounty",   "Saturday, Balaji posted a bounty.", 0.5),
    ("rules",    "Two thousand and forty-eight dollars, to prove anyone can run their own Farcaster. No API keys. No permission.", 0.6),
    ("tried",    "So I tried.", 0.3),
    ("blocked",  "Hetzner said no. AWS said no. Azure was sold out, size after size, until one wasn't.", 0.8),
    ("download", "Eleven hours later, my node had downloaded half a terabyte of Farcaster.", 0.5),
    ("behind",   "Except one shard. Five hundred and seventy days behind.", 1.0),
    ("fix",      "Its snapshot had vanished mid-download. So I wrote a fix, and sent it to the Snapchain team.", 0.6),
    ("sync",     "An hour later, every shard was in sync.", 0.8),
    ("key",      "Then I typed my seed phrase, once. The client made its own key. No gas. No wallet transaction.", 0.6),
    ("cast",     "And I posted. From my own node.", 2.2),
    ("end",      "Three commands. Your own Farcaster. Link's below. Your turn.", 1.8),
]


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


async def voiceover():
    for sid, text, _ in SCENES:
        await edge_tts.Communicate(text, VOICE, rate="+12%").save(str(PUB / f"vo_{sid}.mp3"))


def write_wav(name, x):
    x = np.clip(x, -1, 1)
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    with wave.open(str(PUB / name), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def t(sec):
    return np.arange(int(sec * SR)) / SR


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):  # small buffers only
        acc = (1 - a) * v + a * acc; y[i] = acc
    return y


def lowpass_fast(x, cutoff):
    # one-pole lowpass via FFT-free recursion is slow in Python; use an FIR approximation
    n = int(SR / cutoff)
    k = np.ones(max(n, 1)) / max(n, 1)
    return np.convolve(x, k, mode="same")


def note(n):  # MIDI -> Hz
    return 440 * 2 ** ((n - 69) / 12)


# ---------- sound effects ----------

def sfx():
    rng = np.random.default_rng(7)
    # keyboard: a few seconds of irregular clicks
    x = np.zeros(int(4 * SR)); pos = 0
    while pos < len(x) - 2000:
        n = 600
        click = rng.normal(0, 1, n) * np.exp(-np.arange(n) / 90)
        click = np.diff(click, prepend=0)  # brighter
        x[pos:pos + n] += click * rng.uniform(0.25, 0.45)
        pos += int(SR * rng.uniform(0.045, 0.09))
    write_wav("sfx_typing.wav", x * 0.6)

    # error: low thud + distorted buzz
    tt = t(0.45)
    thud = np.sin(2 * np.pi * (90 * np.exp(-tt * 6)) * tt) * np.exp(-tt * 9)
    buzz = np.sign(np.sin(2 * np.pi * 110 * tt)) * np.exp(-tt * 12) * 0.25
    write_wav("sfx_error.wav", (thud + buzz) * 0.8)

    # whoosh: filtered noise swell
    tt = t(0.6)
    nz = rng.normal(0, 1, len(tt))
    env = np.sin(np.pi * tt / tt[-1]) ** 2
    write_wav("sfx_whoosh.wav", lowpass_fast(nz, 1500) * env * 1.2)

    # success: two-note chime
    tt = t(1.0)
    chime = sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt * d) * g
                for f, d, g in [(note(84), 4, .5), (note(91), 3, .35), (note(96), 5, .15)])
    late = np.zeros_like(tt); s = int(0.09 * SR)
    late[s:] = chime[:-s]
    write_wav("sfx_success.wav", (chime * 0.5 + late * 0.6) * 0.5)

    # tick for counters
    tt = t(0.03)
    write_wav("sfx_tick.wav", np.sin(2 * np.pi * 2000 * tt) * np.exp(-tt * 200) * 0.3)

    # impact for the drop
    tt = t(1.6)
    boom = np.sin(2 * np.pi * (60 * np.exp(-tt * 3) + 30) * tt) * np.exp(-tt * 2.5)
    write_wav("sfx_impact.wav", boom * 0.9)


# ---------- music ----------

def music(total, marks):
    """Dark pulse until `sync`, riser into it, bright groove after, accent at `cast`."""
    bpm = 100; beat = 60 / bpm
    n = int(total * SR); out = np.zeros(n)
    tt = np.arange(n) / SR
    rng = np.random.default_rng(1)

    def place(sig, at, gain=1.0):
        i = int(at * SR)
        if i >= n: return
        j = min(n, i + len(sig)); out[i:j] += sig[:j - i] * gain

    def pad(chord, dur, bright):
        x = t(dur); s = np.zeros_like(x)
        for m in chord:
            for det in (-0.08, 0.0, 0.08):
                f = note(m + det)
                s += (2 * ((f * x) % 1) - 1) * 0.12  # saw
        s = lowpass_fast(s, 900 if bright else 500)
        env = np.minimum(1, x / 0.4) * np.minimum(1, (dur - x) / 0.4)
        return s * env

    def kick():
        x = t(0.5)
        return np.sin(2 * np.pi * (45 + 110 * np.exp(-x * 25)) * x) * np.exp(-x * 7)

    def hat(open_=False):
        x = t(0.25 if open_ else 0.06)
        h = np.diff(rng.normal(0, 1, len(x)), prepend=0)
        return h * np.exp(-x * (18 if open_ else 70)) * 0.15

    def clap():
        x = t(0.2)
        return lowpass_fast(rng.normal(0, 1, len(x)), 2500) * np.exp(-x * 25) * 0.5

    def bass(m, dur):
        x = t(dur)
        return np.sin(2 * np.pi * note(m) * x) * np.minimum(1, x / 0.02) * np.exp(-x * 1.5) * 0.5

    dark = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]      # Am F Dm E
    bright = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]    # C G Am F
    bar = beat * 4
    sync, blocked, cast = marks["sync"], marks["blocked"], marks["cast"]

    b = 0.0; i = 0
    while b < total:
        is_bright = b >= sync - 0.01
        chords = bright if is_bright else dark
        ch = chords[i % 4]
        place(pad(ch, bar + 0.4, is_bright), b, 0.55 if is_bright else 0.45)
        place(bass(ch[0] - 24, bar), b, 0.9)
        for k in range(4):
            at = b + k * beat
            if at >= total: break
            if b >= blocked - 0.01:  # drums come in when things go wrong
                place(kick(), at, 0.9)
            if is_bright:
                place(hat(), at + beat / 2)
                place(hat(), at + beat / 4, 0.5); place(hat(), at + 3 * beat / 4, 0.5)
                if k in (1, 3): place(clap(), at)
            elif b >= blocked - 0.01:
                place(hat(), at + beat / 2, 0.7)
        b += bar; i += 1

    # riser into `sync`
    rl = 2.4; x = t(rl)
    riser = lowpass_fast(rng.normal(0, 1, len(x)), 3000) * (x / rl) ** 2 * 0.5
    riser += np.sin(2 * np.pi * (200 + 600 * (x / rl) ** 2) * x) * (x / rl) ** 2 * 0.15
    place(riser, sync - rl)

    # fade out
    fade = int(2.5 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    out /= np.max(np.abs(out)) + 1e-9
    write_wav("music.wav", out * 0.9)


def main():
    asyncio.run(voiceover())
    timeline, at = [], 0.6  # short beat of music before the first word
    for sid, text, extra in SCENES:
        vo = duration(PUB / f"vo_{sid}.mp3")
        timeline.append({"id": sid, "text": text, "start": round(at, 3), "vo": round(vo, 3), "dur": round(vo + extra, 3)})
        at += vo + extra
    total = round(at + 0.4, 3)
    marks = {s["id"]: s["start"] for s in timeline}
    sfx()
    music(total, marks)
    (ROOT / "src" / "timeline.json").write_text(json.dumps({"total": total, "scenes": timeline}, indent=1))
    print(f"total {total:.1f}s")
    for s in timeline:
        print(f"  {s['start']:6.2f}  {s['id']:9} vo {s['vo']:.2f}s")


if __name__ == "__main__":
    main()
