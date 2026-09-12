"""Policy PDF text extraction (plan §18 P5-T2).

Extracts text via `pypdf` first; if the result is too short to be useful
(a scanned/image-only PDF), falls back to the mock OCR provider's fixture
sidecar. Real OCR is out of scope for this phase.
"""

import hashlib
from io import BytesIO

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from agent_service.providers.ocr import MockOcrProvider

MIN_EXTRACTED_TEXT_CHARS = 40


async def extract_pages(pdf_bytes: bytes, ocr_provider: MockOcrProvider) -> list[str]:
    """Returns one string per page. Falls back to a single OCR-fixture page
    (page-boundary information is not recoverable from a plain text sidecar)
    when pypdf extracts too little text overall — including when the bytes
    aren't a parseable PDF at all (a scan saved as a raw image wrapped in a
    non-standard container is exactly the case OCR exists for; pypdf raising
    is not a reason to fail the whole indexing run).
    """
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
    except PdfReadError:
        pages = []
    total_chars = sum(len(page) for page in pages)

    if total_chars >= MIN_EXTRACTED_TEXT_CHARS:
        return pages

    document_hash = hashlib.sha256(pdf_bytes).hexdigest()
    ocr_text = await ocr_provider.extract_text(document_hash)
    if ocr_text:
        return [ocr_text]
    return pages
