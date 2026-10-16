"""Extract Genki (3rd ed.) vocabulary for chapters 14+ from the official index spreadsheet.

Usage: python3 scripts/extract_vocab.py path/to/sheet.xlsx > data/vocab.json
Requires openpyxl.
"""
import json
import re
import sys

import openpyxl

MIN_CHAPTER = 14
TAG_RE = re.compile(r"(会|読)L(\d+)(\(e\))?")


def main(path: str) -> None:
    wb = openpyxl.load_workbook(path, read_only=True)
    rows = list(wb.worksheets[0].iter_rows(values_only=True))
    out = []
    for r in rows:
        if not isinstance(r[0], (int, float)):
            continue
        no, kana, kanji, pos, en, lessons = r[:6]
        tags = []
        for t in str(lessons or "").split(","):
            m = TAG_RE.search(t.strip())
            if m:
                book, ch, extra = m.groups()
                src = "extra" if extra else ("conv" if book == "会" else "read")
                tags.append((int(ch), src))
        if not tags:
            continue
        # Already taught in a main lesson before chapter 14 -> skip.
        if any(ch < MIN_CHAPTER and src == "conv" for ch, src in tags):
            continue
        later = [t for t in tags if t[0] >= MIN_CHAPTER]
        if not later:
            continue
        ch = min(t[0] for t in later)
        srcs = {s for c, s in later if c == ch}
        src = "conv" if "conv" in srcs else ("read" if "read" in srcs else "extra")
        out.append({
            "id": f"v{int(no)}",
            "kana": str(kana).strip(),
            "kanji": str(kanji).strip() if kanji else None,
            "pos": str(pos).strip() if pos else "",
            "en": re.sub(r"\s+", " ", str(en)).strip().replace("’", "'"),
            "chapter": ch,
            "source": src,
        })
    out.sort(key=lambda v: (v["chapter"], ["conv", "extra", "read"].index(v["source"]), int(v["id"][1:])))
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
