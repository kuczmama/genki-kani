# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = ["kokoro>=0.9.4", "misaki[ja]>=0.9.4", "soundfile", "numpy"]
# ///
"""Generate natural-sounding audio for every word and example sentence with Kokoro TTS.

    uv run scripts/generate_audio.py            # only (re)generates what changed
    uv run scripts/generate_audio.py --force    # regenerate everything
    uv run scripts/generate_audio.py --voice jm_kumo

Writes frontend/public/audio/<id>.mp3 (word) and <id>-<n>.mp3 (sentences); the site
falls back to browser speech for anything missing. data/audio-cache.json remembers
what text/voice each file was made from, so reruns are incremental. Needs ffmpeg.

Kokoro reads kanji with UniDic, which occasionally picks the wrong reading. Every
sentence's UniDic reading is checked against our furigana, and any span it would
misread is handed to Kokoro as kana instead.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
VOCAB = ROOT / "data" / "vocab.json"
SENTENCES = ROOT / "data" / "sentences"
OUT = ROOT / "frontend" / "public" / "audio"
CACHE = ROOT / "data" / "audio-cache.json"
SAMPLE_RATE = 24000

KANJI = r"㐀-鿿々〆ヶ"
RUBY = re.compile(rf"([{KANJI}0-9０-９]+)\[([^\]]+)\]")


def kata2hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def only_kana(s: str) -> str:
    return re.sub(r"[^ぁ-ゖー]", "", kata2hira(s))


def segments(ja: str) -> list[tuple[str, str]]:
    """Split `日本[にほん]で{雪[ゆき]}` into [(surface, reading), ...] with braces removed."""
    ja = ja.replace("{", "").replace("}", "")
    out, pos = [], 0
    for m in RUBY.finditer(ja):
        for ch in ja[pos : m.start()]:
            out.append((ch, ch))
        base, rt = m.group(1), m.group(2)
        digits = re.match(r"[0-9０-９]*", base).group(0)
        for ch in digits:
            out.append((ch, ch))
        out.append((base[len(digits) :], rt))
        pos = m.end()
    for ch in ja[pos:]:
        out.append((ch, ch))
    return out


def fix_readings(tagger, segs: list[tuple[str, str]]) -> tuple[str, int]:
    """Return text for TTS, with kana substituted wherever UniDic disagrees with our furigana."""
    text = "".join(s for s, _ in segs)
    tokens = [(w.surface, w.feature.kana or w.surface) for w in tagger(text)]
    # Walk tokens and segments together, grouping until their boundaries line up.
    out, fixes = [], 0
    ti = si = 0
    while si < len(segs) or ti < len(tokens):
        seg_s, seg_r, tok_s, tok_r = "", "", "", ""
        while True:
            if len(seg_s) <= len(tok_s) and si < len(segs):
                seg_s += segs[si][0]
                seg_r += segs[si][1]
                si += 1
            elif ti < len(tokens):
                tok_s += tokens[ti][0]
                tok_r += tokens[ti][1]
                ti += 1
            else:
                break
            if seg_s == tok_s or (si >= len(segs) and ti >= len(tokens)):
                break
        has_kanji = re.search(rf"[{KANJI}]", seg_s)
        if has_kanji and seg_s == tok_s and only_kana(seg_r) != only_kana(tok_r):
            out.append(seg_r)
            fixes += 1
        else:
            out.append(seg_s)
    return "".join(out), fixes


def word_text(v: dict) -> tuple[str, str]:
    """(kanji-ish text, kana) for the headword, with Genki's notation cleaned up."""
    def clean(s: str) -> str:
        s = s.split("／")[0]
        m = re.search(r"[（(]([^）)]*)[）)]", s)
        if m:
            inner = m.group(1)
            rest = s[: m.start()] + s[m.end() :]
            s = inner + rest if inner.endswith("を") else rest
        return re.sub(r"[～〜…X！!（）()]", "", s).strip()

    kana = clean(v["kana"])
    return (clean(v["kanji"]) if v.get("kanji") else kana), kana


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="jf_alpha", help="jf_alpha, jf_gongitsune, jf_nezumi, jf_tebukuro, jm_kumo")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", help="comma-separated vocab ids (for testing)")
    args = ap.parse_args()

    import unidic

    if not Path(unidic.DICDIR, "mecabrc").exists():
        print("Downloading UniDic dictionary (one time, ~500MB)…")
        subprocess.run([sys.executable, "-m", "unidic", "download"], check=True)

    import numpy as np
    from fugashi import Tagger
    from kokoro import KPipeline

    tagger = Tagger()
    vocab = json.loads(VOCAB.read_text())
    sentences: dict[str, list[dict]] = {}
    for f in sorted(SENTENCES.glob("L*.json")):
        sentences.update(json.loads(f.read_text()))
    if args.only:
        keep = set(args.only.split(","))
        vocab = [v for v in vocab if v["id"] in keep]

    # Build the job list: (filename, text for TTS).
    jobs: list[tuple[str, str]] = []
    fixed = 0
    for v in vocab:
        kanji, kana = word_text(v)
        reading = "".join(w.feature.kana or w.surface for w in tagger(kanji))
        jobs.append((f"{v['id']}.mp3", kanji if only_kana(reading) == only_kana(kana) else kana))
        for i, s in enumerate(sentences.get(v["id"], [])):
            text, n = fix_readings(tagger, segments(s["ja"]))
            fixed += n
            jobs.append((f"{v['id']}-{i}.mp3", text))

    OUT.mkdir(parents=True, exist_ok=True)
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    key = lambda text: hashlib.sha1(f"{args.voice}|{args.speed}|{text}".encode()).hexdigest()
    todo = [(f, t) for f, t in jobs if args.force or cache.get(f) != key(t) or not (OUT / f).exists()]
    print(f"{len(jobs)} clips, {len(todo)} to generate ({fixed} sentence spans read from furigana)")
    if not todo:
        return

    pipeline = KPipeline(lang_code="j", repo_id="hexgrad/Kokoro-82M")
    for n, (fname, text) in enumerate(todo, 1):
        chunks = [c.audio.numpy() for c in pipeline(text, voice=args.voice, speed=args.speed) if c.audio is not None]
        if not chunks:
            print(f"  ! no audio for {fname}: {text}")
            continue
        audio = np.concatenate(chunks)
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1", "-i", "-",
             "-codec:a", "libmp3lame", "-b:a", "48k", str(OUT / fname)],
            input=pcm, check=True,
        )
        cache[fname] = key(text)
        if n % 50 == 0 or n == len(todo):
            CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True))
            print(f"  {n}/{len(todo)}")
    CACHE.write_text(json.dumps(cache, indent=0, sort_keys=True))


if __name__ == "__main__":
    main()
