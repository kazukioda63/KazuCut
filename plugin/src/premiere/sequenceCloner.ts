import { createError } from "../errors";
import type { KazuCutError } from "../types";
import type { PremiereAdapter, SequenceRef } from "./premiereAdapter";

export type CloneOutcome =
  | { ok: true; cloned: SequenceRef }
  | { ok: false; error: KazuCutError };

/**
 * シーケンスを複製し、複製前後のGUID差分で新規シーケンスを特定する（仕様14章）。
 * 名前で特定しない。新規が1件だけでなければ中止する。
 */
export async function cloneAndIdentify(
  adapter: PremiereAdapter,
  sourceGuid: string
): Promise<CloneOutcome> {
  let before: SequenceRef[];
  try {
    before = await adapter.listSequences();
  } catch (e) {
    return fail("SEQUENCE_CLONE_FAILED", e);
  }
  const beforeGuids = new Set(before.map((s) => s.guid));

  try {
    await adapter.cloneSequence(sourceGuid);
  } catch (e) {
    return fail("SEQUENCE_CLONE_FAILED", e);
  }

  let after: SequenceRef[];
  try {
    after = await adapter.listSequences();
  } catch (e) {
    return fail("CLONED_SEQUENCE_NOT_IDENTIFIED", e);
  }
  const added = after.filter((s) => !beforeGuids.has(s.guid));
  if (added.length !== 1) {
    return {
      ok: false,
      error: createError(
        "CLONED_SEQUENCE_NOT_IDENTIFIED",
        `複製後の新規シーケンスが${added.length}件（期待: 1件）`
      )
    };
  }
  const cloned = added[0];
  if (!cloned) {
    return fail("CLONED_SEQUENCE_NOT_IDENTIFIED", new Error("added[0] undefined"));
  }
  return { ok: true, cloned };
}

function fail(code: string, e: unknown): CloneOutcome {
  return {
    ok: false,
    error: createError(code, e instanceof Error ? e.message : String(e))
  };
}
