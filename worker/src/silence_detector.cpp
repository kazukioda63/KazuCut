#include "kazucut/silence_detector.hpp"

#include "kazucut/audio_types.hpp"

#include <algorithm>
#include <cmath>

namespace kazucut {

namespace {

constexpr double kDbFloor = -100.0;   // 完全無音のdB表現
constexpr double kClampFloorLo = -85.0;  // ノイズフロアの下限Clamp
constexpr double kClampFloorHi = -25.0;  // ノイズフロアの上限Clamp

double percentile(std::vector<float> sorted, double p) {
    if (sorted.empty()) return kDbFloor;
    const double idx = p * static_cast<double>(sorted.size() - 1);
    const size_t lo = static_cast<size_t>(idx);
    const size_t hi = std::min(lo + 1, sorted.size() - 1);
    const double frac = idx - static_cast<double>(lo);
    return sorted[lo] * (1.0 - frac) + sorted[hi] * frac;
}

}  // namespace

SilenceDetector::SilenceDetector(const SilenceParams& params) : params_(params) {}

void SilenceDetector::pushChunk(const float* samples, size_t count) {
    pending_.insert(pending_.end(), samples, samples + count);
    totalSamples_ += static_cast<int64_t>(count);
    processFrames();
}

void SilenceDetector::processFrames() {
    const size_t frameLen = static_cast<size_t>(kAnalysisSampleRate) * kFrameMs / 1000;  // 320
    const size_t hopLen = static_cast<size_t>(kAnalysisSampleRate) * kHopMs / 1000;      // 160
    while (pending_.size() >= frameLen) {
        double sumSq = 0.0;
        int zc = 0;
        for (size_t i = 0; i < frameLen; i++) {
            const float s = pending_[i];
            sumSq += static_cast<double>(s) * s;
            if (i > 0 && ((s >= 0.0f) != (pending_[i - 1] >= 0.0f))) zc++;
        }
        const double rms = std::sqrt(sumSq / static_cast<double>(frameLen));
        const double db = rms > 1e-9 ? 20.0 * std::log10(rms) : kDbFloor;
        frameDb_.push_back(static_cast<float>(std::max(db, kDbFloor)));
        frameZcr_.push_back(static_cast<float>(zc) / static_cast<float>(frameLen));
        pending_.erase(pending_.begin(), pending_.begin() + static_cast<std::ptrdiff_t>(hopLen));
    }
}

SilenceAnalysisResult SilenceDetector::finalize(std::stop_token stopToken) {
    SilenceAnalysisResult result;
    result.totalDurationMs = totalSamples_ * 1000 / kAnalysisSampleRate;
    if (frameDb_.empty()) return result;

    // --- ノイズフロア推定（パーセンタイル+中央値+MAD、外れ値除外、Clamp） ---
    std::vector<float> valid;
    valid.reserve(frameDb_.size());
    for (float db : frameDb_) {
        if (db > kDbFloor + 1.0) valid.push_back(db);  // 完全無音フレームは外れ値として除外
    }
    double floorDb;
    if (valid.empty()) {
        floorDb = kDbFloor;
    } else {
        std::sort(valid.begin(), valid.end());
        // 10パーセンタイル = 静かなフレーム群の代表値。
        // 発話が優勢な素材で中央値系の推定を使うとフロアが発話レベル側へ
        // 引き上げられるため使用しない。無音が全く無い素材では発話レベルに
        // なり得るが、上限Clamp(-25dB)によりしきい値が発話を無音扱いに
        // することを防ぐ。
        floorDb = std::clamp(percentile(valid, 0.10), kClampFloorLo, kClampFloorHi);
    }
    result.noiseFloorDb = floorDb;

    // --- しきい値（自動 = フロア + マージン、または手動） ---
    const double threshold =
        params_.autoThreshold ? floorDb + params_.noiseMarginDb : params_.manualThresholdDb;
    result.thresholdDb = threshold;

    // --- VAD（エネルギー + ゼロ交差率、感度0〜3） ADR-002 ---
    // 感度が高いほど発話判定が厳しくなる（無音側に倒れる）
    const double vadMarginBySensitivity[4] = {2.0, 4.0, 6.0, 9.0};
    double vadThreshold = floorDb + vadMarginBySensitivity[std::clamp(params_.vadSensitivity, 0, 3)];
    if (params_.quietVoiceProtection) vadThreshold -= 3.0;  // 小声保護: より小さな声も発話扱い

    const size_t n = frameDb_.size();
    std::vector<uint8_t> speech(n, 0);
    for (size_t i = 0; i < n; i++) {
        const bool levelSpeech = frameDb_[i] > threshold;
        bool vadSpeech = false;
        if (params_.vadEnabled) {
            // エネルギーがVADしきい値超、かつZCRが有声/無声音声の範囲
            // （白色ノイズはZCR≈0.5、音声は概ね0.02〜0.45）
            const bool energetic = frameDb_[i] > vadThreshold;
            const bool voiceLikeZcr = frameZcr_[i] > 0.02f && frameZcr_[i] < 0.45f;
            vadSpeech = energetic && voiceLikeZcr;
        }
        // 音量とVADが矛盾する場合は発話保護を優先（仕様22章）
        speech[i] = (levelSpeech || vadSpeech) ? 1 : 0;
    }

    // --- ヒステリシス: 発話へ戻るには threshold + hysteresisDb が必要 ---
    // （無音状態から抜けるときに小さな揺らぎで戻らないようにする）
    {
        bool inSilence = speech.empty() ? true : (speech[0] == 0);
        for (size_t i = 0; i < n; i++) {
            if (inSilence) {
                const bool exitSilence =
                    frameDb_[i] > threshold + params_.hysteresisDb || (params_.vadEnabled && speech[i]);
                if (exitSilence) {
                    inSilence = false;
                } else {
                    speech[i] = 0;
                }
            } else {
                if (speech[i] == 0) inSilence = true;
            }
        }
    }

    if (stopToken.stop_requested()) {
        result.cancelled = true;
        return result;
    }

    // --- 短い発話島（minSpeechMs未満）を無音へ統合 ---
    const int minSpeechFrames = params_.minSpeechMs / kHopMs;
    {
        size_t i = 0;
        while (i < n) {
            if (speech[i]) {
                size_t j = i;
                while (j < n && speech[j]) j++;
                const bool leftSilent = i > 0;
                const bool rightSilent = j < n;
                if (static_cast<int>(j - i) < minSpeechFrames && leftSilent && rightSilent) {
                    std::fill(speech.begin() + static_cast<std::ptrdiff_t>(i),
                              speech.begin() + static_cast<std::ptrdiff_t>(j), uint8_t{0});
                }
                i = j;
            } else {
                i++;
            }
        }
    }

    // --- 無音run→区間化（フレーム境界＝10msスナップ） ---
    std::vector<SilenceInterval> raw;
    {
        size_t i = 0;
        while (i < n) {
            if (!speech[i]) {
                size_t j = i;
                while (j < n && !speech[j]) j++;
                // フレームiの開始 = i*hop、最終フレームの終了 = (j-1)*hop + frame長
                SilenceInterval iv;
                iv.startMs = static_cast<int64_t>(i) * kHopMs;
                iv.endMs = static_cast<int64_t>(j - 1) * kHopMs + kFrameMs;
                if (j == n) iv.endMs = std::max(iv.endMs, result.totalDurationMs);
                raw.push_back(iv);
                i = j;
            } else {
                i++;
            }
        }
    }

    // --- 後処理: 最小無音時間 / 先頭・末尾 / 前後余白 ---
    for (const auto& iv : raw) {
        const int64_t duration = iv.endMs - iv.startMs;
        if (duration < params_.minSilenceMs) continue;
        const bool leading = iv.startMs == 0;
        const bool trailing = iv.endMs >= result.totalDurationMs;
        if (leading && !params_.processLeadingSilence) continue;
        if (trailing && !params_.processTrailingSilence) continue;
        SilenceInterval padded;
        // 語尾保護: 発話終わりから prePaddingMs は削らない（先頭無音を除く）
        padded.startMs = leading ? iv.startMs : iv.startMs + params_.prePaddingMs;
        // 語頭保護: 次の発話の postPaddingMs 手前で止める（末尾無音を除く）
        padded.endMs = trailing ? iv.endMs : iv.endMs - params_.postPaddingMs;
        if (padded.endMs - padded.startMs <= 0) continue;
        result.intervals.push_back(padded);
    }
    return result;
}

}  // namespace kazucut
