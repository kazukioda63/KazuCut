#include <catch2/catch_amalgamated.hpp>

#include <filesystem>
#include <fstream>

#include "kazucut/job_runner.hpp"
#include "kazucut/protocol.hpp"
#include "synthetic.hpp"
#include "kazucut/wav_decoder.hpp"

using namespace kazucut;
using nlohmann::json;

TEST_CASE("ticksToHns: Tick→100ns変換（オーバーフローなし）", "[protocol]") {
    CHECK(ticksToHns(0) == 0);
    CHECK(ticksToHns(254016000000LL) == 10'000'000);          // 1秒
    CHECK(ticksToHns(127008000000LL) == 5'000'000);           // 0.5秒
    CHECK(ticksToHns(254016000000LL * 3600) == 36'000'000'000LL);  // 1時間
}

namespace {

// テスト用WAV生成（test_wav_decoder.cppと同等の簡易版）
std::string makeSpeechWav() {
    std::vector<float> samples;
    testutil::appendTone(samples, 1000, 0.3f);
    testutil::appendSilence(samples, 500);
    testutil::appendTone(samples, 1000, 0.3f);
    const auto dir = std::filesystem::temp_directory_path() / "kazucut-tests";
    std::filesystem::create_directories(dir);
    const auto path = dir / "protocol_speech.wav";
    std::ofstream f(path, std::ios::binary);
    const uint32_t dataSize = static_cast<uint32_t>(samples.size()) * 2;
    const uint32_t riffSize = 36 + dataSize;
    const uint32_t sampleRate = 16000, byteRate = 32000, fmtSize = 16;
    const uint16_t fmtTag = 1, channels = 1, blockAlign = 2, bits = 16;
    f.write("RIFF", 4);
    f.write(reinterpret_cast<const char*>(&riffSize), 4);
    f.write("WAVE", 4);
    f.write("fmt ", 4);
    f.write(reinterpret_cast<const char*>(&fmtSize), 4);
    f.write(reinterpret_cast<const char*>(&fmtTag), 2);
    f.write(reinterpret_cast<const char*>(&channels), 2);
    f.write(reinterpret_cast<const char*>(&sampleRate), 4);
    f.write(reinterpret_cast<const char*>(&byteRate), 4);
    f.write(reinterpret_cast<const char*>(&blockAlign), 2);
    f.write(reinterpret_cast<const char*>(&bits), 2);
    f.write("data", 4);
    f.write(reinterpret_cast<const char*>(&dataSize), 4);
    for (float s : samples) {
        const int16_t v = static_cast<int16_t>(s * 32767.0f);
        f.write(reinterpret_cast<const char*>(&v), 2);
    }
    return path.string();
}

}  // namespace

TEST_CASE("analyzeジョブ: WAVの無音解析が動作する", "[protocol][job]") {
    MessageWriter writer;
    json request = {{"type", "analyze"},
                    {"jobId", "t1"},
                    {"mediaPath", makeSpeechWav()},
                    {"silence", {{"minSilenceMs", 280}, {"vadSensitivity", 2}}}};
    const int code = runJob(request, writer, {});
    CHECK(code == 0);
}

TEST_CASE("analyzeジョブ: fillerセクション+モデル未存在はWHISPER_MODEL_NOT_FOUND", "[protocol][job]") {
    MessageWriter writer;
    json request = {{"type", "analyze"},
                    {"jobId", "t2"},
                    {"mediaPath", makeSpeechWav()},
                    {"filler", {{"modelPath", "/no/such/model.bin"}}}};
    const int code = runJob(request, writer, {});
    CHECK(code == 1);
}

TEST_CASE("未知のジョブtypeはエラー終了", "[protocol][job]") {
    MessageWriter writer;
    json request = {{"type", "unknown-type"}, {"jobId", "t3"}};
    CHECK(runJob(request, writer, {}) == 1);
}

TEST_CASE("testジョブ: 完了する", "[protocol][job]") {
    MessageWriter writer;
    json request = {{"type", "test"}, {"jobId", "t4"}, {"durationMs", 200}, {"payload", "こんにちは"}};
    CHECK(runJob(request, writer, {}) == 0);
}

TEST_CASE("testジョブ: キャンセルで終了コード2", "[protocol][job][cancel]") {
    MessageWriter writer;
    json request = {{"type", "test"}, {"jobId", "t5"}, {"durationMs", 10000}};
    std::stop_source src;
    src.request_stop();
    CHECK(runJob(request, writer, src.get_token()) == 2);
}
