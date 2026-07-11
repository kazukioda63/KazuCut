#include <catch2/catch_amalgamated.hpp>

#include "kazucut/silence_detector.hpp"
#include "synthetic.hpp"

using namespace kazucut;
using namespace kazucut::testutil;

namespace {

SilenceAnalysisResult analyze(const std::vector<float>& samples, const SilenceParams& params) {
    SilenceDetector detector(params);
    // チャンク処理の検証を兼ねて分割push
    constexpr size_t chunkSize = 1600;  // 100ms
    for (size_t i = 0; i < samples.size(); i += chunkSize) {
        detector.pushChunk(samples.data() + i, std::min(chunkSize, samples.size() - i));
    }
    return detector.finalize();
}

SilenceParams defaultParams() {
    SilenceParams p;
    p.minSilenceMs = 280;
    p.prePaddingMs = 35;
    p.postPaddingMs = 60;
    p.minSpeechMs = 100;
    p.noiseMarginDb = 7.0;
    p.hysteresisDb = 3.0;
    return p;
}

bool coversRange(const std::vector<SilenceInterval>& intervals, int64_t startMs, int64_t endMs,
                 int64_t toleranceMs) {
    for (const auto& iv : intervals) {
        if (std::llabs(iv.startMs - startMs) <= toleranceMs &&
            std::llabs(iv.endMs - endMs) <= toleranceMs) {
            return true;
        }
    }
    return false;
}

}  // namespace

TEST_CASE("完全無音は1区間として検出される", "[silence]") {
    std::vector<float> samples(kAnalysisSampleRate * 2, 0.0f);  // 2秒完全無音
    auto r = analyze(samples, defaultParams());
    REQUIRE(r.intervals.size() == 1);
    CHECK(r.intervals[0].startMs == 0);
    CHECK(r.intervals[0].endMs >= 1990);
    CHECK(r.totalDurationMs == 2000);
}

TEST_CASE("発話中央の500ms無音を検出する", "[silence]") {
    std::vector<float> samples;
    appendTone(samples, 1000, 0.3f);
    appendSilence(samples, 500);
    appendTone(samples, 1000, 0.3f);
    auto r = analyze(samples, defaultParams());
    REQUIRE(r.intervals.size() == 1);
    // 前余白35ms・後余白60msでパディングされる
    CHECK(r.intervals[0].startMs >= 1000);
    CHECK(r.intervals[0].startMs <= 1080);
    CHECK(r.intervals[0].endMs >= 1400);
    CHECK(r.intervals[0].endMs <= 1500);
}

TEST_CASE("最小無音時間未満（100ms）は検出しない", "[silence]") {
    std::vector<float> samples;
    appendTone(samples, 1000, 0.3f);
    appendSilence(samples, 100);
    appendTone(samples, 1000, 0.3f);
    auto r = analyze(samples, defaultParams());
    CHECK(r.intervals.empty());
}

TEST_CASE("一定ノイズフロア上の無音も自動しきい値で検出する", "[silence][noise]") {
    std::vector<float> samples;
    // ノイズ振幅0.01（≈-40dB）のルームノイズ、発話は0.3
    appendTone(samples, 1000, 0.3f);
    appendSilence(samples, 600, 0.01f);
    appendTone(samples, 1000, 0.3f);
    auto r = analyze(samples, defaultParams());
    REQUIRE(r.intervals.size() == 1);
    CHECK(r.noiseFloorDb > -60.0);
    CHECK(r.noiseFloorDb < -25.0);
    CHECK(coversRange(r.intervals, 1035, 1540, 120));
}

TEST_CASE("小声保護: ノイズフロア近傍の小声はVADで削除されない", "[silence][vad]") {
    // フロア≈-49dB（ノイズ振幅0.0062）、小声≈-45dB、しきい値=-49+7=-42dB。
    // 音量判定では小声(-45dB)は無音側だが、小声保護ON時はVADが発話として保護する。
    std::vector<float> samples;
    appendTone(samples, 800, 0.3f);
    appendSilence(samples, 500, 0.0062f);
    appendTone(samples, 600, 0.0104f);  // 小声（-45dB相当）
    appendSilence(samples, 500, 0.0062f);
    appendTone(samples, 800, 0.3f);

    auto p = defaultParams();
    p.quietVoiceProtection = true;
    auto r = analyze(samples, p);
    // 小声部分（1300〜1900ms）が無音区間に含まれないこと
    for (const auto& iv : r.intervals) {
        CHECK_FALSE((iv.startMs < 1850 && iv.endMs > 1350));
    }
    // 前後の本物の無音は検出される
    CHECK(r.intervals.size() == 2);

    // 保護OFFなら小声は音量判定どおり無音側になる（対照実験）
    p.quietVoiceProtection = false;
    auto r2 = analyze(samples, p);
    bool quietCut = false;
    for (const auto& iv : r2.intervals) {
        if (iv.startMs < 1850 && iv.endMs > 1350) quietCut = true;
    }
    CHECK(quietCut);
}

TEST_CASE("ヒステリシス: しきい値付近の揺らぎで無音が細切れにならない", "[silence][hysteresis]") {
    std::vector<float> samples;
    appendTone(samples, 800, 0.3f);
    // しきい値付近の微小揺らぎを含む無音600ms
    appendSilence(samples, 200, 0.001f);
    appendTone(samples, 30, 0.004f);  // 短いポップ（しきい値をわずかに超える）
    appendSilence(samples, 370, 0.001f);
    appendTone(samples, 800, 0.3f);
    auto r = analyze(samples, defaultParams());
    REQUIRE(r.intervals.size() == 1);  // 1つの無音として扱われる
}

TEST_CASE("先頭・末尾無音のON/OFF", "[silence]") {
    std::vector<float> samples;
    appendSilence(samples, 500);
    appendTone(samples, 1000, 0.3f);
    appendSilence(samples, 500);

    auto p = defaultParams();
    auto r = analyze(samples, p);
    CHECK(r.intervals.size() == 2);

    p.processLeadingSilence = false;
    p.processTrailingSilence = false;
    auto r2 = analyze(samples, p);
    CHECK(r2.intervals.empty());
}

TEST_CASE("短い発話島（minSpeech未満）は無音へ統合される", "[silence]") {
    std::vector<float> samples;
    appendTone(samples, 800, 0.3f);
    appendSilence(samples, 400);
    appendTone(samples, 50, 0.3f);  // 50msの島（リップノイズ相当）
    appendSilence(samples, 400);
    appendTone(samples, 800, 0.3f);
    auto r = analyze(samples, defaultParams());
    REQUIRE(r.intervals.size() == 1);  // 島を挟んで1つの無音
    CHECK(r.intervals[0].endMs - r.intervals[0].startMs > 700);
}

TEST_CASE("手動しきい値モード", "[silence]") {
    std::vector<float> samples;
    appendTone(samples, 800, 0.3f);
    appendSilence(samples, 500, 0.001f);
    appendTone(samples, 800, 0.3f);
    auto p = defaultParams();
    p.autoThreshold = false;
    p.manualThresholdDb = -50.0;
    auto r = analyze(samples, p);
    REQUIRE(r.intervals.size() == 1);
    CHECK(r.thresholdDb == -50.0);
}

TEST_CASE("クリッピングした大音量でも正常動作", "[silence]") {
    std::vector<float> samples;
    appendTone(samples, 500, 1.5f);  // クリッピング相当
    appendSilence(samples, 500);
    appendTone(samples, 500, 1.5f);
    auto r = analyze(samples, defaultParams());
    REQUIRE(r.intervals.size() == 1);
}

TEST_CASE("キャンセルでcancelledフラグ", "[silence][cancel]") {
    std::vector<float> samples;
    appendTone(samples, 500, 0.3f);
    SilenceDetector detector(defaultParams());
    detector.pushChunk(samples.data(), samples.size());
    std::stop_source src;
    src.request_stop();
    auto r = detector.finalize(src.get_token());
    CHECK(r.cancelled);
}

TEST_CASE("空入力は空結果", "[silence]") {
    SilenceDetector detector(defaultParams());
    auto r = detector.finalize();
    CHECK(r.intervals.empty());
    CHECK(r.totalDurationMs == 0);
}
