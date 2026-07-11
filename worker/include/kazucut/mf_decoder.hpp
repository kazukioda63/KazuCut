#pragma once

#if defined(_WIN32)

#include "kazucut/audio_types.hpp"

namespace kazucut {

// Windows Media Foundation Source Readerによるデコーダ（ADR-002 / 仕様21章）。
// 16kHz mono f32へ変換してチャンク出力する。
// Seekは不正確前提: Sample Timestampで前後Cropし、誤差をseekErrorHnsへ記録する。
//
// 注意: このクラスはWindows実機でのみビルド・検証可能。
// 現時点（Linux開発環境）ではコンパイル未検証（FINAL_REPORT.md参照）。
class MediaFoundationAudioDecoder final : public IAudioDecoder {
public:
    DecodeResult decode(const DecodeRequest& request,
                        const ChunkCallback& onChunk,
                        std::stop_token stopToken) override;
};

}  // namespace kazucut

#endif  // _WIN32
