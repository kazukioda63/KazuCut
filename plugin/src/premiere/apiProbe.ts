/**
 * Premiere API Probe（仕様12章・Phase 2）。
 *
 * Premiere 26.3.0実機のUXP環境でのみ実行可能。実行結果は
 * plugin-data:/diagnostics/api-probe.json へ保存し、docs/api-probe.md へ転記する。
 * 本番シーケンスは変更しない（読み取り系のみ実行。変更系は専用テスト
 * シーケンス上で明示ボタンから実行）。
 */
import type { ProbeResult } from "../types";

/** UXPグローバル（require("premierepro")）の緩い型 */
type PProModule = Record<string, unknown>;

interface ProbeDef {
  apiName: string;
  /** true: DOMを変更し得るため専用テストシーケンスでのみ実行 */
  mutating: boolean;
  run: (ppro: PProModule) => Promise<{ observed: unknown; notes: string[] }>;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  const t = typeof v;
  if (t === "object") {
    const ctor = (v as { constructor?: { name?: string } }).constructor?.name;
    return ctor ?? "object";
  }
  return t;
}

async function getProject(ppro: PProModule): Promise<unknown> {
  const Project = ppro.Project as { getActiveProject?: () => Promise<unknown> } | undefined;
  if (!Project?.getActiveProject) throw new Error("Project.getActiveProjectがありません");
  return Project.getActiveProject();
}

async function getActiveSequence(ppro: PProModule): Promise<unknown> {
  const project = (await getProject(ppro)) as {
    getActiveSequence?: () => Promise<unknown>;
  } | null;
  if (!project?.getActiveSequence) throw new Error("project.getActiveSequenceがありません");
  return project.getActiveSequence();
}

/** 読み取り専用のProbe定義（変更系はmutating=true） */
export function probeDefinitions(): ProbeDef[] {
  const defs: ProbeDef[] = [
    {
      apiName: "Project.getActiveProject",
      mutating: false,
      run: async (ppro) => ({ observed: await getProject(ppro), notes: [] })
    },
    {
      apiName: "project.getActiveSequence",
      mutating: false,
      run: async (ppro) => ({ observed: await getActiveSequence(ppro), notes: [] })
    },
    {
      apiName: "project.getSequences",
      mutating: false,
      run: async (ppro) => {
        const project = (await getProject(ppro)) as {
          getSequences?: () => Promise<unknown>;
        };
        return { observed: await project.getSequences?.(), notes: [] };
      }
    },
    {
      apiName: "sequence.guid",
      mutating: false,
      run: async (ppro) => {
        const seq = (await getActiveSequence(ppro)) as { guid?: unknown };
        return { observed: seq?.guid, notes: ["読み取り専用プロパティ（25.6+）"] };
      }
    },
    {
      apiName: "sequence.getVideoTrackCount/getVideoTrack",
      mutating: false,
      run: async (ppro) => {
        const seq = (await getActiveSequence(ppro)) as {
          getVideoTrackCount?: () => Promise<number>;
          getVideoTrack?: (i: number) => Promise<unknown>;
        };
        const count = await seq.getVideoTrackCount?.();
        const first = count && count > 0 ? await seq.getVideoTrack?.(0) : undefined;
        return { observed: first, notes: [`videoTrackCount=${String(count)}`] };
      }
    },
    {
      apiName: "sequence.getAudioTrackCount/getAudioTrack",
      mutating: false,
      run: async (ppro) => {
        const seq = (await getActiveSequence(ppro)) as {
          getAudioTrackCount?: () => Promise<number>;
          getAudioTrack?: (i: number) => Promise<unknown>;
        };
        const count = await seq.getAudioTrackCount?.();
        const first = count && count > 0 ? await seq.getAudioTrack?.(0) : undefined;
        return { observed: first, notes: [`audioTrackCount=${String(count)}`] };
      }
    },
    {
      apiName: "sequence.getSelection",
      mutating: false,
      run: async (ppro) => {
        const seq = (await getActiveSequence(ppro)) as {
          getSelection?: () => Promise<unknown>;
        };
        return { observed: await seq.getSelection?.(), notes: [] };
      }
    },
    {
      apiName: "sequence.getPlayerPosition",
      mutating: false,
      run: async (ppro) => {
        const seq = (await getActiveSequence(ppro)) as {
          getPlayerPosition?: () => Promise<unknown>;
        };
        const pos = await seq.getPlayerPosition?.();
        const ticks = (pos as { ticks?: unknown })?.ticks;
        return {
          observed: pos,
          notes: [`ticks=${String(ticks)} (type=${typeof ticks})`]
        };
      }
    },
    {
      apiName: "TickTime.createWithSeconds(1).ticks",
      mutating: false,
      run: async (ppro) => {
        const TickTime = ppro.TickTime as {
          createWithSeconds?: (s: number) => { ticks?: unknown };
        };
        const t = TickTime?.createWithSeconds?.(1);
        return {
          observed: t?.ticks,
          notes: [
            "1秒=254016000000 ticksの仮定を検証する（constants.ts参照）",
            `実測値: ${String(t?.ticks)}`
          ]
        };
      }
    },
    {
      apiName: "BigInt利用可否",
      mutating: false,
      run: async () => {
        const big = BigInt("9007199254740993") + BigInt(1);
        return {
          observed: big.toString(),
          notes: ["UXP環境でBigInt演算が正しいか（9007199254740994になること）"]
        };
      }
    },
    {
      apiName: "project.lockedAccess",
      mutating: false,
      run: async (ppro) => {
        const project = (await getProject(ppro)) as { lockedAccess?: unknown };
        return { observed: project?.lockedAccess, notes: ["関数の存在確認のみ（実行しない）"] };
      }
    },
    {
      apiName: "project.executeTransaction",
      mutating: false,
      run: async (ppro) => {
        const project = (await getProject(ppro)) as { executeTransaction?: unknown };
        return { observed: project?.executeTransaction, notes: ["関数の存在確認のみ（実行しない）"] };
      }
    }
  ];
  // 変更系（専用テストシーケンスでのみ実行）
  const mutating: [string, string][] = [
    ["sequence.createCloneAction (シーケンス複製)", "複製→GUID差分→1件のみか"],
    ["sequence.createSubsequence", "複製代替手段としての挙動"],
    ["TrackItem Clone (createCloneTrackItemAction)", "リンクAudio同時複製有無/isInsert=false"],
    ["TrackItem In/Out変更Action", "リンク連動有無"],
    ["TrackItem Move Action", "リップル発生有無"],
    ["TrackItem削除Action", "リップル発生有無"],
    ["Subclip作成", "戦略B用"],
    ["Sequence削除", "失敗複製の後始末用"],
    ["Transcript.hasTranscript / exportToJSON", "JSON Schema採取"],
    ["Marker追加", "候補プレビュー用"]
  ];
  for (const [apiName, note] of mutating) {
    defs.push({
      apiName,
      mutating: true,
      run: async () => ({
        observed: undefined,
        notes: [note, "専用テストシーケンス上で手動実行すること（本番シーケンス禁止）"]
      })
    });
  }
  return defs;
}

/**
 * Probeを実行する。mutatingな項目はincludeMutating=trueかつ
 * 専用テストシーケンスがアクティブな場合のみ実行対象にする（既定はスキップ）。
 */
export async function runApiProbe(
  ppro: PProModule,
  includeMutating = false
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const def of probeDefinitions()) {
    if (def.mutating && !includeMutating) {
      results.push({
        apiName: def.apiName,
        available: false,
        succeeded: false,
        notes: ["未実行（変更系のため専用テストシーケンスで明示実行が必要）", ...(await def
          .run(ppro)
          .then((r) => r.notes)
          .catch(() => []))]
      });
      continue;
    }
    try {
      const { observed, notes } = await def.run(ppro);
      results.push({
        apiName: def.apiName,
        available: observed !== undefined && observed !== null,
        succeeded: true,
        observedReturnType: typeName(observed),
        notes
      });
    } catch (e) {
      results.push({
        apiName: def.apiName,
        available: false,
        succeeded: false,
        notes: [],
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return results;
}
