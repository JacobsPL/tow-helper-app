from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import pdfplumber


DEFAULT_SOURCE = Path(r"C:\Users\jakub\Downloads\karty-magii v6.pdf")
DEFAULT_OUTPUT = Path("assets") / "magic_cards"
DEFAULT_DPI = 300


@dataclass
class SpellCard:
    sequence: int
    lore: str
    spell_name: str
    spell_number: str
    spell_type: str
    casting_value: str
    spell_range: str
    flavour: str
    effect: str
    pdf_page: int
    back_pdf_page: int
    folder: str
    front_image: str
    back_image: str


def find_pdftoppm(explicit_path: str | None) -> str:
    if explicit_path:
        path = Path(explicit_path)
        if not path.exists():
            raise FileNotFoundError(f"pdftoppm not found: {path}")
        return str(path)

    bundled = (
        Path.home()
        / ".cache"
        / "codex-runtimes"
        / "codex-primary-runtime"
        / "dependencies"
        / "native"
        / "poppler"
        / "Library"
        / "bin"
        / "pdftoppm.exe"
    )
    if bundled.exists():
        return str(bundled)

    found = shutil.which("pdftoppm")
    if found:
        return found

    raise FileNotFoundError("pdftoppm was not found. Install Poppler or pass --pdftoppm.")


def slugify(value: str) -> str:
    replacements = {
        "&": " and ",
        "+": " plus ",
        "’": "",
        "'": "",
        "\"": "",
        "”": "",
        "“": "",
    }
    for source, target in replacements.items():
        value = value.replace(source, target)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_") or "card"


def clean_line(line: str) -> str:
    return re.sub(r"\s+", " ", line).strip()


def join_wrapped_lines(lines: list[str]) -> str:
    text = ""
    keep_hyphen_prefixes = {"re", "sub", "non"}

    for raw in lines:
        line = clean_line(raw)
        if not line:
            continue
        if not text:
            text = line
            continue

        if text.endswith("-") and line[:1].islower():
            prefix = text.rsplit(" ", 1)[-1][:-1].lower()
            if prefix in keep_hyphen_prefixes:
                text += line
            else:
                text = text[:-1] + line
        else:
            text += " " + line

    return re.sub(r"\s+", " ", text).strip()


def group_words_into_lines(words: list[dict], tolerance: float = 1.2) -> list[str]:
    grouped: list[list[dict]] = []

    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        for group in grouped:
            if abs(group[0]["top"] - word["top"]) <= tolerance:
                group.append(word)
                break
        else:
            grouped.append([word])

    lines = []
    for group in grouped:
        line = " ".join(word["text"] for word in sorted(group, key=lambda item: item["x0"]))
        lines.append(clean_line(line))
    return lines


def parse_lore(lines: list[str]) -> tuple[str, int]:
    if len(lines) >= 2 and lines[0] == "LORE OF":
        return f"LORE OF {lines[1]}", 2
    if not lines:
        return "UNKNOWN", 0
    return lines[0], 1


def parse_title(page) -> tuple[list[str], str, str]:
    words = page.extract_words(extra_attrs=["size", "fontname"], use_text_flow=False)
    title_words = [
        word
        for word in words
        if 40 <= word["top"] <= 75
        and 11 <= float(word.get("size", 0)) <= 13
        and "Bold" in word.get("fontname", "")
    ]
    title_lines = group_words_into_lines(title_words)
    title = clean_line(" ".join(title_lines))

    spell_number = ""
    match = re.match(r"^(\d+)\.\s+(.*)$", title)
    if match:
        spell_number = match.group(1)
        title = match.group(2).strip()

    return title_lines, title, spell_number


def parse_table(page) -> tuple[str, str, str]:
    words = page.extract_words(extra_attrs=["size", "fontname"], use_text_flow=False)
    effect_tops = [word["top"] for word in words if word["text"] == "Effect:"]
    if not effect_tops:
        return "", "", ""

    effect_top = min(effect_tops)
    value_words = [
        word
        for word in words
        if 112 <= word["top"] < effect_top - 0.5
        and float(word.get("size", 0)) >= 8
        and word["text"] not in {"Type:", "Casting", "Value:", "Range:"}
    ]

    def collect(predicate) -> str:
        selected = [word for word in value_words if predicate(word)]
        return clean_line(" ".join(word["text"] for word in sorted(selected, key=lambda item: (item["top"], item["x0"]))))

    spell_type = collect(lambda word: word["x0"] < 70)
    if spell_type == "Magic Missle":
        spell_type = "Magic Missile"
    casting_value = collect(lambda word: 70 <= word["x0"] < 121)
    spell_range = collect(lambda word: word["x0"] >= 121)
    return spell_type, casting_value, spell_range


def parse_effect(lines: list[str]) -> str:
    for index, line in enumerate(lines):
        if line.startswith("Effect:"):
            first = line.removeprefix("Effect:").strip()
            return join_wrapped_lines([first, *lines[index + 1 :]])
    return ""


def parse_flavour(lines: list[str], lore_line_count: int, title_line_count: int) -> str:
    header_index = next((index for index, line in enumerate(lines) if "Type:" in line), len(lines))
    start = lore_line_count + title_line_count
    return join_wrapped_lines(lines[start:header_index])


def parse_cards(source_pdf: Path) -> list[SpellCard]:
    cards: list[SpellCard] = []
    folder_by_lore: OrderedDict[str, str] = OrderedDict()
    sequence_by_lore: dict[str, int] = {}

    with pdfplumber.open(str(source_pdf)) as pdf:
        for page_index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if "Type:" not in text or "Effect:" not in text:
                continue

            lines = [clean_line(line) for line in text.splitlines() if clean_line(line)]
            lore, lore_line_count = parse_lore(lines)
            title_lines, title, spell_number = parse_title(page)
            spell_type, casting_value, spell_range = parse_table(page)
            flavour = parse_flavour(lines, lore_line_count, len(title_lines))
            effect = parse_effect(lines)

            if lore not in folder_by_lore:
                folder_by_lore[lore] = slugify(lore)
                sequence_by_lore[lore] = 0
            sequence_by_lore[lore] += 1
            sequence = sequence_by_lore[lore]
            folder = folder_by_lore[lore]
            front_file = f"{sequence:02d}_{slugify(title)}.png"

            cards.append(
                SpellCard(
                    sequence=sequence,
                    lore=lore,
                    spell_name=title,
                    spell_number=spell_number,
                    spell_type=spell_type,
                    casting_value=casting_value,
                    spell_range=spell_range,
                    flavour=flavour,
                    effect=effect,
                    pdf_page=page_index,
                    back_pdf_page=page_index + 1,
                    folder=folder,
                    front_image=f"{folder}/{front_file}",
                    back_image=f"{folder}/back.png",
                )
            )

    return cards


def render_page(pdftoppm: str, source_pdf: Path, page_number: int, output_png: Path, dpi: int) -> None:
    output_png.parent.mkdir(parents=True, exist_ok=True)
    prefix = output_png.with_suffix("")
    subprocess.run(
        [
            pdftoppm,
            "-png",
            "-r",
            str(dpi),
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            "-singlefile",
            str(source_pdf),
            str(prefix),
        ],
        check=True,
    )


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "lore",
        "sequence",
        "spell_number",
        "spell_name",
        "type",
        "casting_value",
        "range",
        "flavour",
        "effect",
        "pdf_page",
        "back_pdf_page",
        "front_image",
        "back_image",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def row_from_card(card: SpellCard) -> dict:
    return {
        "lore": card.lore,
        "sequence": card.sequence,
        "spell_number": card.spell_number,
        "spell_name": card.spell_name,
        "type": card.spell_type,
        "casting_value": card.casting_value,
        "range": card.spell_range,
        "flavour": card.flavour,
        "effect": card.effect,
        "pdf_page": card.pdf_page,
        "back_pdf_page": card.back_pdf_page,
        "front_image": card.front_image,
        "back_image": card.back_image,
    }


def write_manifest(output_dir: Path, source_pdf: Path, cards: list[SpellCard], dpi: int) -> None:
    grouped: OrderedDict[str, list[SpellCard]] = OrderedDict()
    for card in cards:
        grouped.setdefault(card.lore, []).append(card)

    manifest = {
        "source_pdf": str(source_pdf),
        "dpi": dpi,
        "total_spell_cards": len(cards),
        "total_lore_folders": len(grouped),
        "ignored_pages": "Pages without Type/Effect text were skipped; in this PDF that includes backs and objective cards.",
        "lores": [
            {
                "lore": lore,
                "folder": group[0].folder,
                "spell_count": len(group),
                "front_pages": [card.pdf_page for card in group],
                "back_page_used": group[0].back_pdf_page,
                "back_image": group[0].back_image,
                "csv": f"{group[0].folder}/spells.csv",
            }
            for lore, group in grouped.items()
        ],
    }
    with (output_dir / "manifest.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)


def write_readme(output_dir: Path, source_pdf: Path, cards: list[SpellCard]) -> None:
    grouped: OrderedDict[str, list[SpellCard]] = OrderedDict()
    for card in cards:
        grouped.setdefault(card.lore, []).append(card)

    lines = [
        "# Magic Cards Extraction",
        "",
        f"Source PDF: `{source_pdf}`",
        "",
        "Each folder contains spell front PNG files, one `back.png` for that lore/domain, and a `spells.csv` file with parsed gameplay text.",
        "",
        "A top-level `all_spells.csv` aggregates all parsed spell cards. Pages without `Type:` and `Effect:` were skipped, which excludes card backs and the objective cards at the end of the PDF.",
        "",
        "## Lore Folders",
        "",
    ]
    for lore, group in grouped.items():
        lines.append(f"- `{group[0].folder}` - {lore} ({len(group)} spells)")

    (output_dir / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def export_cards(source_pdf: Path, output_dir: Path, pdftoppm: str, dpi: int) -> list[SpellCard]:
    cards = parse_cards(source_pdf)
    if not cards:
        raise RuntimeError("No spell cards were found in the PDF.")

    output_dir.mkdir(parents=True, exist_ok=True)
    grouped: OrderedDict[str, list[SpellCard]] = OrderedDict()
    for card in cards:
        grouped.setdefault(card.lore, []).append(card)

    for lore, group in grouped.items():
        lore_dir = output_dir / group[0].folder
        lore_dir.mkdir(parents=True, exist_ok=True)

        render_page(pdftoppm, source_pdf, group[0].back_pdf_page, lore_dir / "back.png", dpi)
        for card in group:
            render_page(pdftoppm, source_pdf, card.pdf_page, output_dir / card.front_image, dpi)

        rows = [row_from_card(card) for card in group]
        write_csv(lore_dir / "spells.csv", rows)

    write_csv(output_dir / "all_spells.csv", [row_from_card(card) for card in cards])
    write_manifest(output_dir, source_pdf, cards, dpi)
    write_readme(output_dir, source_pdf, cards)

    return cards


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Warhammer The Old World magic cards from a PDF.")
    parser.add_argument("--source", default=str(DEFAULT_SOURCE), help="Path to the source PDF.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output directory.")
    parser.add_argument("--dpi", default=DEFAULT_DPI, type=int, help="PNG render DPI.")
    parser.add_argument("--pdftoppm", default=None, help="Optional path to pdftoppm.")
    args = parser.parse_args()

    source_pdf = Path(args.source).expanduser().resolve()
    output_dir = Path(args.output).expanduser().resolve()

    if not source_pdf.exists():
        raise FileNotFoundError(f"Source PDF does not exist: {source_pdf}")

    pdftoppm = find_pdftoppm(args.pdftoppm)
    cards = export_cards(source_pdf, output_dir, pdftoppm, args.dpi)

    lore_count = len({card.lore for card in cards})
    print(f"Extracted {len(cards)} spell cards into {lore_count} lore folders.")
    print(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
