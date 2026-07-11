#pragma once

// テスト用合成音声（16kHz mono f32）

#include <cmath>
#include <cstdint>
#include <random>
#include <vector>

#include "kazucut/audio_types.hpp"

namespace kazucut::testutil {

inline void appendTone(std::vector<float>& out, int ms, float amplitude, float freqHz = 220.0f) {
    const int n = kAnalysisSampleRate * ms / 1000;
    const size_t start = out.size();
    for (int i = 0; i < n; i++) {
        const float t = static_cast<float>(start + static_cast<size_t>(i)) / kAnalysisSampleRate;
        // 基本波+倍音で音声らしいZCRにする
        out.push_back(amplitude * (0.7f * std::sin(2.0f * 3.14159265f * freqHz * t) +
                                   0.3f * std::sin(2.0f * 3.14159265f * freqHz * 3.1f * t)));
    }
}

inline void appendSilence(std::vector<float>& out, int ms, float noiseAmplitude = 0.0005f,
                          uint32_t seed = 42) {
    const int n = kAnalysisSampleRate * ms / 1000;
    std::mt19937 rng(seed + static_cast<uint32_t>(out.size()));
    std::uniform_real_distribution<float> dist(-noiseAmplitude, noiseAmplitude);
    for (int i = 0; i < n; i++) out.push_back(dist(rng));
}

}  // namespace kazucut::testutil
