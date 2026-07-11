// KazuCutWorker: 解析ジョブ1件につきプロセス1件（ADR-001）。
// 起動: KazuCutWorker --job <リクエストJSONファイル>
//       KazuCutWorker --job-stdin   （stdin先頭行がリクエスト）
//       KazuCutWorker --version
// stdinで {"type":"cancel"} を受けると協調キャンセルする。
// stdoutへJSON Linesでstarted/progress/result/error/cancelledを出力する。

#include <fstream>
#include <iostream>
#include <sstream>
#include <stop_token>
#include <string>
#include <thread>

#include <nlohmann/json.hpp>

#include "kazucut/job_runner.hpp"
#include "kazucut/protocol.hpp"

namespace {

// 過大メッセージ対策（仕様7.2）
constexpr size_t kMaxRequestBytes = 8 * 1024 * 1024;

int fail(kazucut::MessageWriter& writer, const std::string& message) {
    writer.error("unknown", "WORKER_PROTOCOL_ERROR", message);
    return 1;
}

}  // namespace

int main(int argc, char** argv) {
    std::ios::sync_with_stdio(false);
    kazucut::MessageWriter writer;

    std::string requestText;
    bool fromStdin = false;
    if (argc >= 2 && std::string(argv[1]) == "--version") {
        nlohmann::json v = {{"workerVersion", kazucut::kWorkerVersion},
#if defined(_WIN32)
                            {"architecture", "windows-x64"},
#else
                            {"architecture", "portable"},
#endif
#if defined(KAZUCUT_ENABLE_WHISPER)
                            {"whisper", true}};
#else
                            {"whisper", false}};
#endif
        std::cout << v.dump() << "\n";
        return 0;
    } else if (argc >= 3 && std::string(argv[1]) == "--job") {
        // 巨大JSONをコマンドラインへ渡さない（仕様7.1）: ファイル経由
        std::ifstream f(argv[2], std::ios::binary);
        if (!f) return fail(writer, std::string("リクエストファイルを開けません: ") + argv[2]);
        std::ostringstream ss;
        ss << f.rdbuf();
        requestText = ss.str();
    } else if (argc >= 2 && std::string(argv[1]) == "--job-stdin") {
        if (!std::getline(std::cin, requestText)) {
            return fail(writer, "stdinからリクエストを読めません");
        }
        fromStdin = true;
    } else {
        return fail(writer, "使用法: KazuCutWorker --job <file> | --job-stdin | --version");
    }

    if (requestText.size() > kMaxRequestBytes) {
        return fail(writer, "リクエストが大きすぎます");
    }

    nlohmann::json request;
    try {
        request = nlohmann::json::parse(requestText);
    } catch (const std::exception& e) {
        return fail(writer, std::string("リクエストJSONが不正です: ") + e.what());
    }

    // 協調キャンセル: stdinの後続行を監視（仕様7.3）。
    // stdinがIPCチャネル（--job-stdin または --watch-stdin指定）の場合、
    // stdinクローズ = 親（Addon/Premiere）終了とみなし孤児として残らないよう停止する。
    bool watchStdin = fromStdin;
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--watch-stdin") watchStdin = true;
    }
    std::stop_source stopSource;
    if (watchStdin) {
        std::thread cancelWatcher([&stopSource]() {
            std::string line;
            while (std::getline(std::cin, line)) {
                if (line.size() > kMaxRequestBytes) continue;
                try {
                    const auto msg = nlohmann::json::parse(line);
                    if (msg.value("type", "") == "cancel") {
                        stopSource.request_stop();
                        return;
                    }
                } catch (const std::exception&) {
                    // 不正JSON行は無視して監視継続（プロトコルを壊さない）
                    continue;
                }
            }
            stopSource.request_stop();
        });
        cancelWatcher.detach();
    }

    return kazucut::runJob(request, writer, stopSource.get_token());
}
