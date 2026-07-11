#pragma once

#include <cstdint>
#include <iostream>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

namespace kazucut {

inline constexpr const char* kWorkerVersion = "0.1.0";

// Tick分解能（Premiere想定値。実機Probe未検証のためplugin側と同じ仮定を使用）
inline constexpr int64_t kTicksPerSecond = 254016000000LL;

// tick → 100ns単位。オーバーフロー回避のため分割演算
inline int64_t ticksToHns(int64_t ticks) {
    // hns = ticks * 10^7 / kTicksPerSecond = ticks * 10 / 254016
    const int64_t q = ticks / 254016;
    const int64_t r = ticks % 254016;
    return q * 10 + r * 10 / 254016;
}

// JSON Lines出力（仕様7.2）。stdoutへ1行1メッセージ、スレッド安全
class MessageWriter {
public:
    void started(const std::string& jobId) {
        emit({{"type", "started"}, {"jobId", jobId}});
    }
    void progress(const std::string& jobId, double value, const std::string& stage) {
        emit({{"type", "progress"}, {"jobId", jobId}, {"progress", value}, {"stage", stage}});
    }
    void result(const std::string& jobId, const nlohmann::json& payload) {
        emit({{"type", "result"}, {"jobId", jobId}, {"result", payload}});
    }
    void error(const std::string& jobId, const std::string& code, const std::string& message) {
        emit({{"type", "error"},
              {"jobId", jobId},
              {"error", {{"code", code}, {"developerMessage", message}}}});
    }
    void cancelled(const std::string& jobId) {
        emit({{"type", "cancelled"}, {"jobId", jobId}});
    }

private:
    std::mutex mutex_;
    void emit(const nlohmann::json& j) {
        std::lock_guard<std::mutex> lock(mutex_);
        std::cout << j.dump() << "\n" << std::flush;
    }
};

}  // namespace kazucut
