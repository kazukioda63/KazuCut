#include "kazucut/job_runner.hpp"

#include <chrono>
#include <filesystem>
#include <thread>

#include "kazucut/audio_types.hpp"
#include "kazucut/silence_detector.hpp"
#include "kazucut/wav_decoder.hpp"

#if defined(_WIN32)
#include "kazucut/mf_decoder.hpp"
#endif

namespace kazucut {

namespace {

std::string lowerExtension(const std::string& path) {
    const auto ext = std::filesystem::path(path).extension().string();
    std::string out;
    for (char c : ext) out += static_cast<char>(::tolower(static_cast<unsigned char>(c)));
    return out;
}

int64_t parseTicksField(const nlohmann::json& j, const char* key) {
    if (!j.contains(key)) return 0;
    const auto& v = j.at(key);
    if (v.is_string()) return std::stoll(v.get<std::string>());
    if (v.is_number_integer()) return v.get<int64_t>();
    throw std::runtime_error(std::string(key) + "はTick文字列である必要があります");
}

SilenceParams parseSilenceParams(const nlohmann::json& s) {
    SilenceParams p;
    p.autoThreshold = s.value("autoThreshold", true);
    p.manualThresholdDb = s.value("manualThresholdDb", -40.0);
    p.noiseMarginDb = s.value("noiseMarginDb", 7.0);
    p.hysteresisDb = s.value("hysteresisDb", 3.0);
    p.minSilenceMs = s.value("minSilenceMs", 280);
    p.prePaddingMs = s.value("prePaddingMs", 35);
    p.postPaddingMs = s.value("postPaddingMs", 60);
    p.minSpeechMs = s.value("minSpeechMs", 100);
    p.vadEnabled = s.value("vadEnabled", true);
    p.vadSensitivity = s.value("vadSensitivity", 2);
    p.quietVoiceProtection = s.value("quietVoiceProtection", true);
    p.processLeadingSilence = s.value("processLeadingSilence", true);
    p.processTrailingSilence = s.value("processTrailingSilence", true);
    return p;
}

int runTestJob(const std::string& jobId, const nlohmann::json& request, MessageWriter& writer,
               std::stop_token stopToken) {
    const int durationMs = request.value("durationMs", 3000);
    const std::string payload = request.value("payload", "");
    const int steps = std::max(durationMs / 100, 1);
    for (int i = 0; i <= steps; i++) {
        if (stopToken.stop_requested()) {
            writer.cancelled(jobId);
            return 2;
        }
        writer.progress(jobId, static_cast<double>(i) / steps, i < steps / 2 ? "decode" : "silence");
        if (i < steps) std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    writer.result(jobId, {{"echo", payload}});
    return 0;
}

int runAnalyzeJob(const std::string& jobId, const nlohmann::json& request, MessageWriter& writer,
                  std::stop_token stopToken) {
    const std::string mediaPath = request.value("mediaPath", "");
    if (mediaPath.empty()) {
        writer.error(jobId, "AUDIO_DECODE_FAILED", "mediaPathがありません");
        return 1;
    }

    // ADR-006: fillerセクションが存在する場合だけWhisper系の検証へ入る。
    // 不在ならこのブロック自体をスキップし、Whisper関連コードへ一切到達しない。
    bool fillerRequested = false;
    std::string modelPath;
    if (request.contains("filler")) {
        fillerRequested = true;
        modelPath = request.at("filler").value("modelPath", "");
        if (modelPath.empty() || !std::filesystem::exists(modelPath)) {
            writer.error(jobId, "WHISPER_MODEL_NOT_FOUND",
                         "Whisperモデルが未設定または存在しません: " + modelPath);
            return 1;
        }
#if !defined(KAZUCUT_ENABLE_WHISPER)
        writer.error(jobId, "WHISPER_FAILED",
                     "このWorkerビルドはWhisper未対応です（KAZUCUT_ENABLE_WHISPER無効）");
        return 1;
#endif
    }

    DecodeRequest decodeRequest;
    decodeRequest.mediaPath = mediaPath;
    decodeRequest.startHns = ticksToHns(parseTicksField(request, "sourceInTicks"));
    decodeRequest.endHns = ticksToHns(parseTicksField(request, "sourceOutTicks"));
    decodeRequest.audioStreamIndex = request.value("audioStreamIndex", 0);
    if (request.contains("silence")) {
        decodeRequest.channelMode = request.at("silence").value("channelMode", "auto");
    }

    // デコーダ選択（ADR-002）
    std::unique_ptr<IAudioDecoder> decoder;
    const std::string ext = lowerExtension(mediaPath);
    if (ext == ".wav") {
        decoder = std::make_unique<WavFileDecoder>();
    } else {
#if defined(_WIN32)
        decoder = std::make_unique<MediaFoundationAudioDecoder>();
#else
        writer.error(jobId, "AUDIO_DECODE_FAILED",
                     "この環境（非Windows）ではWAV以外をデコードできません: " + ext);
        return 1;
#endif
    }

    SilenceParams params =
        request.contains("silence") ? parseSilenceParams(request.at("silence")) : SilenceParams{};
    SilenceDetector detector(params);

    writer.progress(jobId, 0.05, "decode");
    int64_t pushed = 0;
    DecodeResult decodeResult = decoder->decode(
        decodeRequest,
        [&](const AudioChunk& chunk) {
            detector.pushChunk(chunk.samples.data(), chunk.samples.size());
            pushed += static_cast<int64_t>(chunk.samples.size());
            // デコードは進捗0.05〜0.60（総量未知のため対数的に漸近）
            const double p = 0.05 + 0.55 * (1.0 - 1.0 / (1.0 + static_cast<double>(pushed) /
                                                                   (30.0 * kAnalysisSampleRate)));
            writer.progress(jobId, p, "decode");
        },
        stopToken);

    if (!decodeResult.ok) {
        if (decodeResult.error.code == "CANCELLED" || stopToken.stop_requested()) {
            writer.cancelled(jobId);
            return 2;
        }
        writer.error(jobId, decodeResult.error.code, decodeResult.error.message);
        return 1;
    }

    writer.progress(jobId, 0.65, "silence");
    SilenceAnalysisResult analysis = detector.finalize(stopToken);
    if (analysis.cancelled || stopToken.stop_requested()) {
        writer.cancelled(jobId);
        return 2;
    }
    writer.progress(jobId, 0.95, "finalize");

    nlohmann::json intervals = nlohmann::json::array();
    for (const auto& iv : analysis.intervals) {
        intervals.push_back({{"startMs", iv.startMs}, {"endMs", iv.endMs}});
    }
    nlohmann::json payload = {
        {"silence",
         {{"intervals", intervals},
          {"noiseFloorDb", analysis.noiseFloorDb},
          {"thresholdDb", analysis.thresholdDb},
          {"totalDurationMs", analysis.totalDurationMs}}},
        {"seekErrorHns", decodeResult.seekErrorHns},
        {"fillerAnalyzed", false}};
    (void)fillerRequested;  // Whisper統合(Phase 9)まではfillerAnalyzed=false
    writer.result(jobId, payload);
    return 0;
}

}  // namespace

int runJob(const nlohmann::json& request, MessageWriter& writer, std::stop_token stopToken) {
    const std::string jobId = request.value("jobId", "unknown");
    const std::string type = request.value("type", "");
    writer.started(jobId);
    try {
        if (type == "test") return runTestJob(jobId, request, writer, stopToken);
        if (type == "analyze") return runAnalyzeJob(jobId, request, writer, stopToken);
        writer.error(jobId, "WORKER_PROTOCOL_ERROR", "未知のジョブtype: " + type);
        return 1;
    } catch (const std::exception& e) {
        writer.error(jobId, "WORKER_PROTOCOL_ERROR", std::string("例外: ") + e.what());
        return 1;
    }
}

}  // namespace kazucut
