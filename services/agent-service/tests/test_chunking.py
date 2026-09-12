"""Chunking correctness (plan §18 P5-T2)."""

from agent_service.chunking import CHUNK_OVERLAP_CHARS, CHUNK_SIZE_CHARS, chunk_pages


def test_single_short_page_is_one_chunk() -> None:
    chunks = chunk_pages(["This is a short policy clause."])
    assert len(chunks) == 1
    assert chunks[0].page_number == 1
    assert chunks[0].chunk_index == 0


def test_long_page_is_split_with_overlap() -> None:
    text = "word " * 400  # well over CHUNK_SIZE_CHARS
    chunks = chunk_pages([text])
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk.content) <= CHUNK_SIZE_CHARS


def test_chunk_index_is_global_across_pages() -> None:
    chunks = chunk_pages(["Page one content.", "Page two content."])
    assert [c.chunk_index for c in chunks] == list(range(len(chunks)))
    assert chunks[0].page_number == 1
    assert chunks[-1].page_number == 2


def test_blank_pages_produce_no_chunks() -> None:
    chunks = chunk_pages(["", "   ", "Real content here."])
    assert len(chunks) == 1
    assert chunks[0].page_number == 3


def test_heading_detection_picks_up_preceding_short_line() -> None:
    text = "COVERAGE FOR FURNITURE\nDamage to furniture is covered up to the sum insured."
    chunks = chunk_pages([text])
    assert chunks[0].heading == "COVERAGE FOR FURNITURE"


def test_overlap_constant_is_smaller_than_chunk_size() -> None:
    assert CHUNK_OVERLAP_CHARS < CHUNK_SIZE_CHARS
