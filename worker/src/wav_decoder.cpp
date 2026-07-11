#include "kazucut/wav_decoder.hpp"

#include <cstring>
#include <fstream>

namespace kazucut {

namespace {

struct WavFormat {
    uint16_t formatTag = 0;  // 1=PCM, 3=IEEE float
    uint16_t channels = 0;
    uint32_t sampleRate = 0;
    uint16_t bitsPerSample = 0;
};

bool readExact(std::ifstream& f, void* dst, size_t n) {
    f.read(static_cast<char*>(dst), static_cast<std::streamsize>(n));
    return static_cast<size_t>(f.gcount()) == n;
}

float sampleAt(const std::vector<float>& mono, int64_t idx) {
    if (idx < 0) return 0.0f;
    if (idx >= static_cast<int64_t>(mono.size())) return 0.0f;
    return mono[static_cast<size_t>(idx)];
}

}  // namespace

DecodeResult WavFileDecoder::decode(const DecodeRequest& request,
                                    const ChunkCallback& onChunk,
                                    std::stop_token stopToken) {
    DecodeResult result;
    std::ifstream f(request.mediaPath, std::ios::binary);
    if (!f) {
        result.error = {"MEDIA_NOT_FOUND", "ファイルを開けません: " + request.mediaPath};
        return result;
    }

    char riff[4], wave[4];
    uint32_t riffSize = 0;
    if (!readExact(f, riff, 4) || !readExact(f, &riffSize, 4) || !readExact(f, wave, 4) ||
        std::memcmp(riff, "RIFF", 4) != 0 || std::memcmp(wave, "WAVE", 4) != 0) {
        result.error = {"AUDIO_DECODE_FAILED", "RIFF/WAVEヘッダーがありません"};
        return result;
    }

    WavFormat fmt;
    std::vector<uint8_t> data;
    bool haveFmt = false, haveData = false;
    while (f && !(haveFmt && haveData)) {
        char id[4];
        uint32_t size = 0;
        if (!readExact(f, id, 4) || !readExact(f, &size, 4)) break;
        if (std::memcmp(id, "fmt ", 4) == 0) {
            std::vector<uint8_t> buf(size);
            if (!readExact(f, buf.data(), size) || size < 16) {
                result.error = {"AUDIO_DECODE_FAILED", "fmt chunkが不正です"};
                return result;
            }
            std::memcpy(&fmt.formatTag, buf.data(), 2);
            std::memcpy(&fmt.channels, buf.data() + 2, 2);
            std::memcpy(&fmt.sampleRate, buf.data() + 4, 4);
            std::memcpy(&fmt.bitsPerSample, buf.data() + 14, 2);
            haveFmt = true;
        } else if (std::memcmp(id, "data", 4) == 0) {
            data.resize(size);
            if (!readExact(f, data.data(), size)) {
                result.error = {"AUDIO_DECODE_FAILED", "data chunkを読めません"};
                return result;
            }
            haveData = true;
        } else {
            f.seekg(size + (size & 1), std::ios::cur);
        }
    }
    if (!haveFmt || !haveData) {
        result.error = {"AUDIO_STREAM_NOT_FOUND", "fmt/data chunkが見つかりません"};
        return result;
    }
    if (fmt.channels < 1 || fmt.channels > 2 || fmt.sampleRate == 0) {
        result.error = {"AUDIO_DECODE_FAILED", "非対応のチャンネル数/サンプルレート"};
        return result;
    }

    // f32モノラルへ変換
    const size_t bytesPer = fmt.bitsPerSample / 8u;
    if (!((fmt.formatTag == 1 && fmt.bitsPerSample == 16) ||
          (fmt.formatTag == 3 && fmt.bitsPerSample == 32))) {
        result.error = {"AUDIO_DECODE_FAILED",
                        "非対応フォーマット (PCM s16 / IEEE f32 のみ対応)"};
        return result;
    }
    const size_t frameBytes = bytesPer * fmt.channels;
    const size_t frames = data.size() / frameBytes;

    auto readSample = [&](size_t frame, int ch) -> float {
        const uint8_t* p = data.data() + frame * frameBytes + static_cast<size_t>(ch) * bytesPer;
        if (fmt.formatTag == 1) {
            int16_t v;
            std::memcpy(&v, p, 2);
            return static_cast<float>(v) / 32768.0f;
        }
        float v;
        std::memcpy(&v, p, 4);
        return v;
    };

    std::vector<float> mono(frames);
    const bool useLeft = request.channelMode == "left";
    const bool useRight = request.channelMode == "right" && fmt.channels == 2;
    // max-energy: 全体エネルギーが大きいチャンネルを選択
    int chosen = -1;
    if (request.channelMode == "max-energy" && fmt.channels == 2) {
        double e0 = 0, e1 = 0;
        for (size_t i = 0; i < frames; i++) {
            const float l = readSample(i, 0), r = readSample(i, 1);
            e0 += static_cast<double>(l) * l;
            e1 += static_cast<double>(r) * r;
        }
        chosen = e1 > e0 ? 1 : 0;
    }
    for (size_t i = 0; i < frames; i++) {
        if (fmt.channels == 1 || useLeft) {
            mono[i] = readSample(i, 0);
        } else if (useRight) {
            mono[i] = readSample(i, 1);
        } else if (chosen >= 0) {
            mono[i] = readSample(i, chosen);
        } else {  // auto / mix: 平均
            mono[i] = 0.5f * (readSample(i, 0) + readSample(i, 1));
        }
    }
    data.clear();
    data.shrink_to_fit();

    // 要求範囲の切り出し（100ns単位）
    int64_t startSample = 0;
    int64_t endSample = static_cast<int64_t>(frames);
    if (request.endHns > request.startHns) {
        startSample = request.startHns * fmt.sampleRate / 10'000'000;
        endSample = request.endHns * fmt.sampleRate / 10'000'000;
        if (endSample > static_cast<int64_t>(frames)) endSample = static_cast<int64_t>(frames);
        if (startSample > endSample) startSample = endSample;
    }

    // 16kHzへ線形補間リサンプル + チャンク出力
    const double ratio = static_cast<double>(fmt.sampleRate) / kAnalysisSampleRate;
    const int64_t srcLen = endSample - startSample;
    const int64_t outLen =
        static_cast<int64_t>(static_cast<double>(srcLen) / ratio);
    constexpr int64_t kChunkSamples = kAnalysisSampleRate;  // 1秒ずつ
    AudioChunk chunk;
    for (int64_t outStart = 0; outStart < outLen; outStart += kChunkSamples) {
        if (stopToken.stop_requested()) {
            result.error = {"CANCELLED", "デコード中にキャンセル"};
            return result;
        }
        const int64_t n = std::min(kChunkSamples, outLen - outStart);
        chunk.samples.resize(static_cast<size_t>(n));
        chunk.sampleOffset = outStart;
        for (int64_t i = 0; i < n; i++) {
            const double srcPos = static_cast<double>(outStart + i) * ratio;
            const int64_t i0 = startSample + static_cast<int64_t>(srcPos);
            const float frac = static_cast<float>(srcPos - static_cast<double>(static_cast<int64_t>(srcPos)));
            chunk.samples[static_cast<size_t>(i)] =
                sampleAt(mono, i0) * (1.0f - frac) + sampleAt(mono, i0 + 1) * frac;
        }
        onChunk(chunk);
    }

    result.ok = true;
    result.totalSamples = outLen;
    result.seekErrorHns = 0;  // WAVはサンプル精度でSeek可能
    return result;
}

}  // namespace kazucut
