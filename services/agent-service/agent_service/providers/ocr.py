"""Mock OCR provider (plan §18 P5-T2): fixture sidecars only.

Real OCR is out of scope for this phase (the plan's own "mock OCR may use
fixture sidecars"). A document whose extracted text falls below
`MIN_EXTRACTED_TEXT_CHARS` is looked up by its content hash under
`fixtures/ocr/<sha256>.txt`; anything without a matching fixture is treated
as having no recoverable text.
"""

from pathlib import Path

_FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "ocr"


class MockOcrProvider:
    async def extract_text(self, document_hash: str) -> str | None:
        fixture_path = _FIXTURES_DIR / f"{document_hash}.txt"
        if not fixture_path.exists():
            return None
        return fixture_path.read_text()
