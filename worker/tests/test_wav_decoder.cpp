#include <catch2/catch_amalgamated.hpp>

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>

#include "kazucut/wav_decoder.hpp"
#include "synthetic.hpp"

using namespace kazucut;

namespace {

// s16 PCM WAVをテンポラリへ書き出す
std::string writeWav(const std::vector<float>& samples, uint32_t sampleRate, uint16_t channels,
                     const std::string& name) {
    const auto dir = std::filesystem::temp_directory_path() / "kazucut-tests";
    std::filesystem::create_directories(dir);
    const auto path = dir / name;
    std::ofstream f(path, std::ios::binary);
    const uint32_t dataSize =
        static_cast<uint32_t>(samples.size()) * 2;  // samplesはインターリーブ済み
    const uint32_t riffSize = 36 + dataSize;
    const uint32_t byteRate = sampleRate * channels * 2;
    const uint16_t blockAlign = channels * 2;
    const uint16_t bits = 16;
    const uint16_t fmtTag = 1;
    const uint32_t fmtSize = 16;
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
        const int16_t v = static_cast<int16_t>(std::max(-1.0f, std::min(1.0f, s)) * 32767.0f);
        f.write(reinterpret_cast<const char*>(&v), 2);
    }
    return path.string();
}

std::vector<float> collectAll(IAudioDecoder& decoder, const DecodeRequest& req,
                              DecodeResult& result) {
    std::vector<float> all;
    result = decoder.decode(
        req, [&](const AudioChunk& c) { all.insert(all.end(), c.samples.begin(), c.samples.end()); },
        {});
    return all;
}

}  // namespace

TEST_CASE("48kHzモノラルWAVを16kHzへリサンプルする", "[wav]") {
    std::vector<float> src;
    for (int i = 0; i < 48000; i++) src.push_back(0.3f);  // 1秒
    const auto path = writeWav(src, 48000, 1, "mono48k.wav");
    WavFileDecoder decoder;
    DecodeRequest req;
    req.mediaPath = path;
    DecodeResult result;
    auto samples = collectAll(decoder, req, result);
    REQUIRE(result.ok);
    CHECK(samples.size() == 16000);
    CHECK(result.totalSamples == 16000);
    CHECK(std::fabs(samples[8000] - 0.3f) < 0.02f);
}

TEST_CASE("ステレオWAVのチャンネルモード", "[wav]") {
    // L=0.5 / R=0.1 のステレオ1秒
    std::vector<float> interleaved;
    for (int i = 0; i < 16000; i++) {
        interleaved.push_back(0.5f);
        interleaved.push_back(0.1f);
    }
    const auto path = writeWav(interleaved, 16000, 2, "stereo.wav");
    WavFileDecoder decoder;
    DecodeResult result;

    DecodeRequest req;
    req.mediaPath = path;

    req.channelMode = "left";
    auto left = collectAll(decoder, req, result);
    REQUIRE(result.ok);
    CHECK(std::fabs(left[100] - 0.5f) < 0.02f);

    req.channelMode = "right";
    auto right = collectAll(decoder, req, result);
    CHECK(std::fabs(right[100] - 0.1f) < 0.02f);

    req.channelMode = "mix";
    auto mix = collectAll(decoder, req, result);
    CHECK(std::fabs(mix[100] - 0.3f) < 0.02f);

    req.channelMode = "max-energy";
    auto maxE = collectAll(decoder, req, result);
    CHECK(std::fabs(maxE[100] - 0.5f) < 0.02f);
}

TEST_CASE("範囲指定（100ns単位）で切り出す", "[wav]") {
    std::vector<float> src(16000 * 2, 0.2f);  // 2秒
    const auto path = writeWav(src, 16000, 1, "range.wav");
    WavFileDecoder decoder;
    DecodeRequest req;
    req.mediaPath = path;
    req.startHns = 5'000'000;   // 0.5秒
    req.endHns = 15'000'000;    // 1.5秒
    DecodeResult result;
    auto samples = collectAll(decoder, req, result);
    REQUIRE(result.ok);
    CHECK(samples.size() == 16000);  // 1秒分
}

TEST_CASE("存在しないファイルはMEDIA_NOT_FOUND", "[wav]") {
    WavFileDecoder decoder;
    DecodeRequest req;
    req.mediaPath = "/no/such/file.wav";
    DecodeResult result;
    collectAll(decoder, req, result);
    CHECK_FALSE(result.ok);
    CHECK(result.error.code == "MEDIA_NOT_FOUND");
}

TEST_CASE("WAVでないファイルはAUDIO_DECODE_FAILED", "[wav]") {
    const auto dir = std::filesystem::temp_directory_path() / "kazucut-tests";
    std::filesystem::create_directories(dir);
    const auto path = (dir / "notwav.wav").string();
    std::ofstream(path) << "this is not a wav file";
    WavFileDecoder decoder;
    DecodeRequest req;
    req.mediaPath = path;
    DecodeResult result;
    collectAll(decoder, req, result);
    CHECK_FALSE(result.ok);
    CHECK(result.error.code == "AUDIO_DECODE_FAILED");
}

TEST_CASE("日本語・スペースを含むパスを扱える", "[wav][path]") {
    std::vector<float> src(1600, 0.1f);
    const auto path = writeWav(src, 16000, 1, "日本語 スペース付き.wav");
    WavFileDecoder decoder;
    DecodeRequest req;
    req.mediaPath = path;
    DecodeResult result;
    auto samples = collectAll(decoder, req, result);
    REQUIRE(result.ok);
    CHECK(samples.size() == 1600);
}

TEST_CASE("キャンセルでCANCELLED", "[wav][cancel]") {
    std::vector<float> src(16000 * 5, 0.1f);
    const auto path = writeWav(src, 16000, 1, "cancel.wav");
    WavFileDecoder decoder;
    DecodeRequest req;
    req.mediaPath = path;
    std::stop_source stopSource;
    stopSource.request_stop();
    DecodeResult result = decoder.decode(req, [](const AudioChunk&) {}, stopSource.get_token());
    CHECK_FALSE(result.ok);
    CHECK(result.error.code == "CANCELLED");
}
