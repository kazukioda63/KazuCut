#pragma once

#include "kazucut/audio_types.hpp"

namespace kazucut {

// テスト・開発用の移植可能WAVデコーダ（ADR-002）。
// PCM s16/f32、モノラル/ステレオ対応。16kHzモノラルf32へ変換して出力する。
// リサンプルは線形補間（解析用途には十分。再生用途ではない）。
class WavFileDecoder final : public IAudioDecoder {
public:
    DecodeResult decode(const DecodeRequest& request,
                        const ChunkCallback& onChunk,
                        std::stop_token stopToken) override;
};

}  // namespace kazucut
