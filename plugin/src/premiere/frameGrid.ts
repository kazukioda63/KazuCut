/**
 * シーケンスの1フレームTick長を実機APIから取得する（D-021）。
 *
 * 第一候補: Sequence.getTimebase()（公式ドキュメント記載・Promise<string>、
 * 1フレームのTick数を返す想定）。第二候補: getSettings()のvideoFrameRate。
 * どちらも実機未検証のため、取得・解釈に失敗しても例外にせず null を返し、
 * 呼び出し側はフレーム丸めなし（従来動作）で続行する。診断のため生値をnoteへ残す。
 */
import { parseFrameTicks } from "../analysis/frameQuantizer";
import { freshSequence } from "./uxpTimeline";
import type { PproProject } from "./pproTypes";
import type { TickString } from "../ticks";

export interface FrameTicksResult {
  frameTicks: TickString | null;
  /** 診断用: どのAPIから何が取れたか（apply-result.jsonに残す） */
  note: string;
}

export async function sequenceFrameTicks(
  project: PproProject,
  guid: string
): Promise<FrameTicksResult> {
  const notes: string[] = [];
  try {
    const seq = (await freshSequence(project, guid)) as unknown as {
      getTimebase?: () => Promise<unknown>;
      getSettings?: () => Promise<unknown>;
    };

    if (typeof seq.getTimebase === "function") {
      try {
        const raw = await seq.getTimebase();
        notes.push(`getTimebase=${JSON.stringify(raw)}`);
        const parsed = parseFrameTicks(raw);
        if (parsed) return { frameTicks: parsed, note: notes.join(" / ") };
      } catch (e) {
        notes.push(`getTimebase失敗: ${String(e)}`);
      }
    } else {
      notes.push("getTimebaseなし");
    }

    if (typeof seq.getSettings === "function") {
      try {
        const settings = (await seq.getSettings()) as Record<string, unknown> | null;
        const candidates: unknown[] = [];
        if (settings && typeof settings === "object") {
          candidates.push(settings["videoFrameRate"]);
          const getter = settings["getVideoFrameRate"];
          if (typeof getter === "function") {
            candidates.push(await (getter as () => Promise<unknown>).call(settings));
          }
        }
        for (const raw of candidates) {
          if (raw === undefined || raw === null) continue;
          notes.push(`videoFrameRate=${JSON.stringify(raw)}`);
          const parsed = parseFrameTicks(raw);
          if (parsed) return { frameTicks: parsed, note: notes.join(" / ") };
        }
        if (candidates.every((c) => c === undefined || c === null)) {
          notes.push("videoFrameRateなし");
        }
      } catch (e) {
        notes.push(`getSettings失敗: ${String(e)}`);
      }
    } else {
      notes.push("getSettingsなし");
    }
  } catch (e) {
    notes.push(`フレームレート取得失敗: ${String(e)}`);
  }
  return { frameTicks: null, note: notes.join(" / ") };
}
