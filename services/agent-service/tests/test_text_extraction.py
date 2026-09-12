"""Text extraction robustness (live-walkthrough-caught bug, plan §18 P5-T2):
bytes that pypdf cannot parse at all must fall back to OCR, not crash the
whole indexing run — a scanned document saved without a valid PDF header is
exactly the case OCR exists for."""

import asyncio

from agent_service.providers.ocr import MockOcrProvider
from agent_service.providers.text_extraction import extract_pages


def test_unparseable_bytes_fall_back_to_the_ocr_fixture() -> None:
    provider = MockOcrProvider()
    pages = asyncio.run(extract_pages(b"not a real pdf", provider))
    assert pages == ["Furniture damage is covered up to the sum insured under this policy.\n"]


def test_unparseable_bytes_with_no_fixture_return_empty_pages() -> None:
    provider = MockOcrProvider()
    pages = asyncio.run(extract_pages(b"completely unknown garbage bytes", provider))
    assert pages == []
