"""Page-aware policy chunking with overlap (plan §18 P5-T2)."""

import re
from dataclasses import dataclass

CHUNK_SIZE_CHARS = 800
CHUNK_OVERLAP_CHARS = 150

# Best-effort heading detection: a short, mostly-uppercase or title-cased
# line immediately preceding a paragraph. Not a general-purpose PDF layout
# parser — a heuristic that's good enough to attach a human-readable label
# to a citation, nothing more.
_HEADING_LINE = re.compile(r"^[A-Z][A-Za-z0-9 /&,'-]{2,80}$")


@dataclass(frozen=True)
class Chunk:
    page_number: int
    chunk_index: int
    content: str
    heading: str | None


def _detect_heading(content: str) -> str | None:
    """A chunk whose own first line reads like a heading (short, capitalized,
    no sentence punctuation) is labeled with it — good enough to attach a
    human-readable label to a citation, not a layout parser."""
    lines = content.splitlines()
    if not lines:
        return None
    first_line = lines[0].strip()
    if first_line and _HEADING_LINE.match(first_line) and len(first_line.split()) <= 10:
        return first_line
    return None


def chunk_pages(pages: list[str]) -> list[Chunk]:
    """Splits each page into overlapping chunks, indexed globally across the
    whole document (so `chunk_index` is stable and orderable regardless of
    page boundaries).
    """
    chunks: list[Chunk] = []
    global_index = 0

    for page_number, page_text in enumerate(pages, start=1):
        normalized = page_text.strip()
        if not normalized:
            continue

        start = 0
        while start < len(normalized):
            end = min(start + CHUNK_SIZE_CHARS, len(normalized))
            content = normalized[start:end].strip()
            if content:
                heading = _detect_heading(content)
                chunks.append(
                    Chunk(
                        page_number=page_number,
                        chunk_index=global_index,
                        content=content,
                        heading=heading,
                    )
                )
                global_index += 1
            if end >= len(normalized):
                break
            start = end - CHUNK_OVERLAP_CHARS

    return chunks
