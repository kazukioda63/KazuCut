#pragma once

#include <cstdint>
#include <functional>
#include <stop_token>
#include <string>
#include <vector>

namespace kazucut {

// 解析形式（仕様21.2）: 16kHz モノラル
inline constexpr int kAnalysisSampleRate = 16000;

// 巨大PCM一括展開禁止（仕様21.2）: チャンク単位でコールバックへ渡す
struct AudioChunk {
    // f32 PCM（音量解析用）。VAD用s16は受け側で変換する
    std::vector<float> samples;
    // このチャンク先頭の、要求範囲先頭からのサンプルオフセット
    int64_t sampleOffset = 0;
};

struct DecodeRequest {
    std::string mediaPath;
    // 要求範囲（100ns単位、10^7/秒）。0,0で全体
    int64_t startHns = 0;
    int64_t endHns = 0;
    int audioStreamIndex = 0;
    // "auto" | "left" | "right" | "mix" | "max-energy"
    std::string channelMode = "auto";
};

struct DecodeError {
    std::string code;     // AUDIO_DECODE_FAILED 等
    std::string message;  // developer向け詳細
};

struct DecodeResult {
    bool ok = false;
    DecodeError error;
    int64_t totalSamples = 0;
    // Seek誤差ログ（仕様21.3）
    int64_t seekErrorHns = 0;
};

using ChunkCallback = std::function<void(const AudioChunk&)>;

// 仕様21章のIAudioDecoder。チャンクはcallbackへストリーミングする
class IAudioDecoder {
public:
    virtual DecodeResult decode(const DecodeRequest& request,
                                const ChunkCallback& onChunk,
                                std::stop_token stopToken) = 0;
    virtual ~IAudioDecoder() = default;
};

}  // namespace kazucut
