"""Generate the voiceover, the music mix, and the timeline the video follows.

    python scripts/gen_audio.py

Voice: Microsoft neural TTS through edge-tts (no key).
Music: two Kevin MacLeod tracks (incompetech.com, CC BY 4.0), crossfaded where
the story turns. Writes public/*.mp3|wav and src/timeline.json.
"""
import asyncio, json, subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
PUB.mkdir(exist_ok=True)
SR = 44100
VOICE = "en-US-ChristopherNeural"
RATE = "+16%"

# id, narration, extra seconds of picture after the line ends
SCENES = [
    ("bounty",   "Saturday, Balaji posted a bounty.", 0.4),
    ("rules",    "Twenty forty-eight dollars, to prove anyone can run their own Farcaster. No API keys. No permission.", 0.4),
    ("tried",    "So I tried.", 0.3),
    ("blocked",  "Hetzner said no. AWS said no. Azure was sold out, until it wasn't.", 0.6),
    ("download", "Eleven hours later, half a terabyte of Farcaster.", 0.4),
    ("behind",   "Except one shard. Five hundred and seventy days behind.", 0.6),
    ("fix",      "Its snapshot vanished mid-download. So I fixed it, and sent the fix upstream.", 0.5),
    ("sync",     "An hour later, fully in sync.", 0.6),
    ("key",      "Then my seed phrase, once. The client made its own key. No gas.", 0.5),
    ("cast",     "And I posted. From my own node.", 1.7),
    ("end",      "Three commands. Your own Farcaster. Your turn.", 1.5),
]


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


async def voiceover():
    for sid, text, _ in SCENES:
        await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(PUB / f"vo_{sid}.mp3"))












# ---------- music ----------

TRACKS = {  # (file, url)
    "dark": ("Ether_Vox.mp3", "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Ether%20Vox.mp3"),
    "bright": ("Inspired.mp3", "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Inspired.mp3"),
}


def music(total, turn):
    """Ether Vox under the struggle, crossfading into Inspired as the node syncs."""
    src = ROOT / "music"
    src.mkdir(exist_ok=True)
    for name, url in TRACKS.values():
        if not (src / name).exists():
            subprocess.run(["curl", "-fsSL", "-o", str(src / name), url], check=True)
    x, xf = turn - 1.0, 2.0
    graph = (
        f"[0]atrim=0:{x + xf},afade=t=in:d=1.5,afade=t=out:st={x}:d={xf}[a];"
        f"[1]atrim=0:{total - x},adelay={int(x * 1000)}:all=1,afade=t=in:st={x}:d={xf}[b];"
        f"[a][b]amix=inputs=2:normalize=0,atrim=0:{total},afade=t=out:st={total - 3}:d=3,"
        f"loudnorm=I=-16:TP=-2[out]"
    )
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src / TRACKS["dark"][0]), "-i", str(src / TRACKS["bright"][0]),
                    "-filter_complex", graph, "-map", "[out]", "-ar", "44100", str(PUB / "music.wav")], check=True)


def main():
    asyncio.run(voiceover())
    timeline, at = [], 0.4  # short beat of music before the first word
    for sid, text, extra in SCENES:
        vo = duration(PUB / f"vo_{sid}.mp3")
        timeline.append({"id": sid, "text": text, "start": round(at, 3), "vo": round(vo, 3), "dur": round(vo + extra, 3)})
        at += vo + extra
    total = round(at + 0.4, 3)
    marks = {s["id"]: s["start"] for s in timeline}
    music(total, marks["sync"])
    (ROOT / "src" / "timeline.json").write_text(json.dumps({"total": total, "scenes": timeline}, indent=1))
    print(f"total {total:.1f}s")
    for s in timeline:
        print(f"  {s['start']:6.2f}  {s['id']:9} vo {s['vo']:.2f}s")


if __name__ == "__main__":
    main()
