#pragma once

// Workerプロセス管理（ADR-001 / 仕様7-8章）。
// このファイルはUXP SDKに依存しない純Win32実装であり、SDKなしでも
// Windows上で単体ビルド・テスト可能。Linux開発環境では未コンパイル（未検証）。

#if defined(_WIN32)

#include <windows.h>

#include <cstdint>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

namespace kazucut::addon {

enum class JobState { Pending, Running, Completed, Failed, Cancelled };

struct JobStatusSnapshot {
    JobState state = JobState::Pending;
    double progress = 0.0;
    std::string stage;
    std::string errorCode;
    std::string errorMessage;
    std::string resultJson;  // Completed時のみ
};

// 1ジョブ = 1 Workerプロセス。
class Job {
public:
    Job(std::wstring workerExePath, HANDLE jobObject);
    ~Job();
    Job(const Job&) = delete;
    Job& operator=(const Job&) = delete;

    // Worker起動: CreateProcessW、lpApplicationName=絶対パス、Shell経由なし。
    // リクエストはstdin先頭行で渡す（--job-stdin。巨大JSONをコマンドラインへ渡さない）
    bool start(const std::string& requestJsonUtf8, std::string& outError);

    JobStatusSnapshot status();

    // 協調キャンセル: stdinへcancel行→gracePeriod待機→TerminateProcess
    void cancel(int gracePeriodMs = 3000);

    // 監視スレッド停止・ハンドル解放。実行中なら強制終了
    void dispose();

private:
    void readerLoop();
    void handleLine(const std::string& line);
    void markCrashedIfRunning(DWORD exitCode);

    std::wstring workerExePath_;
    HANDLE jobObject_ = nullptr;  // 所有しない（Manager所有）
    PROCESS_INFORMATION process_{};
    HANDLE stdinWrite_ = nullptr;
    HANDLE stdoutRead_ = nullptr;
    std::thread reader_;
    std::mutex mutex_;
    JobStatusSnapshot snapshot_;
    bool started_ = false;
};

// Addon全体で1つ。Job Object（KILL_ON_JOB_CLOSE）を保有し、
// Premiere終了→Addonアンロード→Job Objectクローズ→全Worker道連れ終了を保証する。
class JobManager {
public:
    JobManager();
    ~JobManager();

    // Workerの絶対パスを設定（Addon自身のモジュールパスから解決。ユーザー入力禁止）
    void setWorkerPath(std::wstring path);
    bool workerAvailable() const;
    std::wstring workerPath() const;

    // 戻り値: jobId（失敗時は空文字＋outError）
    std::string startJob(const std::string& requestJsonUtf8, std::string& outError);
    JobStatusSnapshot getStatus(const std::string& jobId);
    std::string getResult(const std::string& jobId);
    bool cancelJob(const std::string& jobId);
    bool disposeJob(const std::string& jobId);
    void disposeAll();

private:
    mutable std::mutex mutex_;
    std::map<std::string, std::unique_ptr<Job>> jobs_;
    std::wstring workerPath_;
    HANDLE jobObject_ = nullptr;
    uint64_t nextId_ = 0;
};

}  // namespace kazucut::addon

#endif  // _WIN32
