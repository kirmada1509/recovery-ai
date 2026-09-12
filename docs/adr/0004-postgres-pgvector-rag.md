# ADR 0004 — Postgres + pgvector for policy retrieval

- **Status:** Accepted
- **Date:** 2026-09-12
- **Plan reference:** Sections 2.1, 6.7, 9.2

## Context

The agent must retrieve policy clauses with citations to support coverage findings and
negotiation arguments. The research reports variously proposed Pinecone, Weaviate,
Redis and Postgres for the vector store.

## Decision

Store policy chunks and their embeddings in Postgres using the `pgvector` extension,
in the agent service's own database. No separate vector database.

Retrieval always filters by `policy_id`. Every chunk carries citation metadata:
document ID, page number, chunk ID and clause heading where detected.

## Consequences

- One datastore to run, back up, migrate and reason about. The local stack stays a
  single Postgres container.
- Chunks and their citation metadata live in the same transactional store as the run
  metadata that references them, so a citation cannot dangle.
- pgvector's index performance is adequate at the scale of one policy document per
  claim; it would need revisiting for corpus-wide semantic search across tenants.
- If a dedicated vector database is ever justified, the retrieval interface is the
  seam to swap — not the call sites.
