#pragma once

#include <stop_token>
#include <string>

#include <nlohmann/json.hpp>

#include "kazucut/protocol.hpp"

namespace kazucut {

// リクエストJSON（1ジョブ）を実行する。戻り値はプロセス終了コード。
// - type="test": 仕様11章のテストジョブ（durationMsかけて進捗、payloadをecho）
// - type="analyze": 音声デコード→無音解析。fillerセクションがある場合のみ
//   Whisper系コードパスへ入る（ADR-006）。
int runJob(const nlohmann::json& request, MessageWriter& writer, std::stop_token stopToken);

}  // namespace kazucut
