import type { Database } from '../db/client.ts';
import { claimEvents, type NewClaimEvent } from '../db/schema.ts';

/** Anything that can run an `insert` — a plain `Database` or a transaction. */
export interface EventWriter {
  insert: Database['insert'];
}

/** Every state change and admin/system decision appends one immutable row. */
export async function recordClaimEvent(
  db: EventWriter,
  event: Omit<NewClaimEvent, 'id' | 'createdAt'>,
): Promise<void> {
  await db.insert(claimEvents).values(event);
}
