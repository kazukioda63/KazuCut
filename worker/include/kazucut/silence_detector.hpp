#pragma once

#include <cstdint>
#include <stop_token>
#include <string>
#include <vector>

namespace kazucut {

// 仕様22章の無音検出設定（plugin側SilenceSettingsと対応）
struct SilenceParams {
    bool autoThreshold = true;
    double manualThresholdDb = -40.0;
    double noiseMarginDb = 7.0;
    double hysteresisDb = 3.0;
    int minSilenceMs = 280;
    int prePaddingMs = 35;    // 発話終わり→削除開始の余白（語尾保護）
    int postPaddingMs = 60;   // 削除終わり→発話始まりの余白（語頭保護）
    int minSpeechMs = 100;    // これ未満の発話島は無音へ統合
    bool vadEnabled = true;
    int vadSensitivity = 2;   // 0緩い〜3厳しい
    bool quietVoiceProtection = true;
    bool processLeadingSilence = true;
    bool processTrailingSilence = true;
};

struct SilenceInterval {
    int64_t startMs = 0;
    int64_t endMs = 0;
};

struct SilenceAnalysisResult {
    std::vector<SilenceInterval> intervals;
    double noiseFloorDb = -80.0;
    double thresholdDb = -60.0;
    int64_t totalDurationMs = 0;
    bool cancelled = false;
};

// フレーム長20ms / ホップ長10ms（仕様22章）
inline constexpr int kFrameMs = 20;
inline constexpr int kHopMs = 10;

// ストリーミング対応の無音検出器。pushChunkでf32/16kHz/monoを渡し、
// finalizeで区間を得る。フレーム特徴量のみ保持し、PCM全体は保持しない。
class SilenceDetector {
public:
    explicit SilenceDetector(const SilenceParams& params);

    void pushChunk(const float* samples, size_t count);
    SilenceAnalysisResult finalize(std::stop_token stopToken = {});

private:
    SilenceParams params_;
    std::vector<float> pending_;      // フレーム境界未満の持ち越し（最大1フレーム）
    std::vector<float> frameDb_;      // フレームごとのdBFS
    std::vector<float> frameZcr_;     // フレームごとのゼロ交差率
    int64_t totalSamples_ = 0;

    void processFrames();
};

}  // namespace kazucut
