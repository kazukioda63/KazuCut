// Workerプロセス管理の実装（Windows専用・Linux開発環境では未コンパイル/未検証）

#if defined(_WIN32)

#include "kazucut_addon/job_manager.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>

namespace kazucut::addon {

namespace {

constexpr size_t kMaxLineBytes = 8 * 1024 * 1024;  // 過大メッセージ対策

}  // namespace

// ---------------- Job ----------------

Job::Job(std::wstring workerExePath, HANDLE jobObject)
    : workerExePath_(std::move(workerExePath)), jobObject_(jobObject) {}

Job::~Job() { dispose(); }

bool Job::start(const std::string& requestJsonUtf8, std::string& outError) {
    // リクエストが1行のJSONであること（改行を含むとプロトコルが壊れる）
    if (requestJsonUtf8.find('\n') != std::string::npos) {
        outError = "リクエストJSONに改行を含めないでください";
        return false;
    }
    if (!std::filesystem::exists(workerExePath_)) {
        outError = "WORKER_NOT_FOUND";
        return false;
    }

    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE stdinRead = nullptr, stdoutWrite = nullptr;
    if (!CreatePipe(&stdinRead, &stdinWrite_, &sa, 0) ||
        !CreatePipe(&stdoutRead_, &stdoutWrite, &sa, 0)) {
        outError = "パイプ作成に失敗しました";
        return false;
    }
    // 親側ハンドルは継承させない
    SetHandleInformation(stdinWrite_, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stdoutRead_, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = stdinRead;
    si.hStdOutput = stdoutWrite;
    si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

    // コマンドライン: 実行ファイル名 + --job-stdin のみ（仕様8.1）。
    // lpApplicationNameへ絶対パスを渡し、Shellを経由しない。
    std::wstring cmdline = L"\"" + workerExePath_ + L"\" --job-stdin";
    std::vector<wchar_t> cmdlineBuf(cmdline.begin(), cmdline.end());
    cmdlineBuf.push_back(L'\0');

    const BOOL ok = CreateProcessW(
        workerExePath_.c_str(),  // lpApplicationName = 絶対パス（検証済み固定Worker）
        cmdlineBuf.data(),
        nullptr, nullptr,
        TRUE,  // ハンドル継承（stdin/stdout）
        CREATE_NO_WINDOW | CREATE_SUSPENDED,
        nullptr, nullptr, &si, &process_);

    CloseHandle(stdinRead);
    CloseHandle(stdoutWrite);

    if (!ok) {
        const DWORD err = GetLastError();
        outError = "CreateProcessW失敗 GetLastError=" + std::to_string(err);
        CloseHandle(stdinWrite_);
        CloseHandle(stdoutRead_);
        stdinWrite_ = stdoutRead_ = nullptr;
        return false;
    }

    // Job Objectへ割当ててから再開（Premiere終了時の道連れ終了を保証: 仕様8.3）
    if (jobObject_ != nullptr) {
        AssignProcessToJobObject(jobObject_, process_.hProcess);
    }
    ResumeThread(process_.hThread);

    // リクエスト送信（stdin先頭行）
    const std::string line = requestJsonUtf8 + "\n";
    DWORD written = 0;
    if (!WriteFile(stdinWrite_, line.data(), static_cast<DWORD>(line.size()), &written, nullptr)) {
        outError = "リクエスト送信に失敗しました";
        TerminateProcess(process_.hProcess, 1);
        return false;
    }

    {
        std::lock_guard<std::mutex> lock(mutex_);
        snapshot_.state = JobState::Running;
    }
    started_ = true;
    reader_ = std::thread([this]() { readerLoop(); });
    return true;
}

void Job::readerLoop() {
    std::string buffer;
    char chunk[4096];
    for (;;) {
        DWORD read = 0;
        if (!ReadFile(stdoutRead_, chunk, sizeof(chunk), &read, nullptr) || read == 0) {
            break;  // パイプ切断 = Worker終了
        }
        buffer.append(chunk, read);
        if (buffer.size() > kMaxLineBytes) {
            std::lock_guard<std::mutex> lock(mutex_);
            snapshot_.state = JobState::Failed;
            snapshot_.errorCode = "WORKER_PROTOCOL_ERROR";
            snapshot_.errorMessage = "メッセージが大きすぎます";
            break;
        }
        size_t pos;
        while ((pos = buffer.find('\n')) != std::string::npos) {
            handleLine(buffer.substr(0, pos));
            buffer.erase(0, pos + 1);
        }
    }
    // プロセス終了コードで異常終了（クラッシュ・途中切断）を検出
    WaitForSingleObject(process_.hProcess, 5000);
    DWORD exitCode = 0;
    GetExitCodeProcess(process_.hProcess, &exitCode);
    markCrashedIfRunning(exitCode);
}

void Job::handleLine(const std::string& line) {
    nlohmann::json msg;
    try {
        msg = nlohmann::json::parse(line);
    } catch (const std::exception&) {
        std::lock_guard<std::mutex> lock(mutex_);
        snapshot_.state = JobState::Failed;
        snapshot_.errorCode = "WORKER_PROTOCOL_ERROR";
        snapshot_.errorMessage = "Workerから不正なJSON行を受信しました";
        return;
    }
    const std::string type = msg.value("type", "");
    std::lock_guard<std::mutex> lock(mutex_);
    if (type == "progress") {
        snapshot_.progress = msg.value("progress", 0.0);
        snapshot_.stage = msg.value("stage", "");
    } else if (type == "result") {
        snapshot_.state = JobState::Completed;
        snapshot_.progress = 1.0;
        snapshot_.resultJson = msg.value("result", nlohmann::json::object()).dump();
    } else if (type == "error") {
        snapshot_.state = JobState::Failed;
        const auto err = msg.value("error", nlohmann::json::object());
        snapshot_.errorCode = err.value("code", "WORKER_PROTOCOL_ERROR");
        snapshot_.errorMessage = err.value("developerMessage", "");
    } else if (type == "cancelled") {
        snapshot_.state = JobState::Cancelled;
    }
    // "started"や未知typeは無視（前方互換）
}

void Job::markCrashedIfRunning(DWORD exitCode) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (snapshot_.state == JobState::Running || snapshot_.state == JobState::Pending) {
        snapshot_.state = JobState::Failed;
        snapshot_.errorCode = "WORKER_CRASHED";
        snapshot_.errorMessage = "Workerが結果を返さず終了しました exitCode=" +
                                 std::to_string(exitCode);
    }
}

JobStatusSnapshot Job::status() {
    std::lock_guard<std::mutex> lock(mutex_);
    return snapshot_;
}

void Job::cancel(int gracePeriodMs) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (snapshot_.state != JobState::Running) return;
    }
    // 1. 協調キャンセル通知
    if (stdinWrite_ != nullptr) {
        const char* line = "{\"type\":\"cancel\"}\n";
        DWORD written = 0;
        WriteFile(stdinWrite_, line, static_cast<DWORD>(strlen(line)), &written, nullptr);
    }
    // 2. 待機 → 3. 応答しなければ強制終了（仕様8.3）
    if (WaitForSingleObject(process_.hProcess, static_cast<DWORD>(gracePeriodMs)) ==
        WAIT_TIMEOUT) {
        TerminateProcess(process_.hProcess, 3);
        std::lock_guard<std::mutex> lock(mutex_);
        snapshot_.state = JobState::Cancelled;
        snapshot_.errorMessage = "協調キャンセルに応答しないため強制終了しました";
    }
}

void Job::dispose() {
    if (started_) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (snapshot_.state == JobState::Running) {
                TerminateProcess(process_.hProcess, 3);
                snapshot_.state = JobState::Cancelled;
            }
        }
        if (stdinWrite_ != nullptr) {
            CloseHandle(stdinWrite_);
            stdinWrite_ = nullptr;
        }
        if (reader_.joinable()) reader_.join();
        if (stdoutRead_ != nullptr) {
            CloseHandle(stdoutRead_);
            stdoutRead_ = nullptr;
        }
        if (process_.hThread != nullptr) CloseHandle(process_.hThread);
        if (process_.hProcess != nullptr) CloseHandle(process_.hProcess);
        process_ = PROCESS_INFORMATION{};
        started_ = false;
    }
}

// ---------------- JobManager ----------------

JobManager::JobManager() {
    jobObject_ = CreateJobObjectW(nullptr, nullptr);
    if (jobObject_ != nullptr) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(jobObject_, JobObjectExtendedLimitInformation, &info,
                                sizeof(info));
    }
}

JobManager::~JobManager() {
    disposeAll();
    if (jobObject_ != nullptr) CloseHandle(jobObject_);  // KILL_ON_JOB_CLOSEで残Worker終了
}

void JobManager::setWorkerPath(std::wstring path) {
    std::lock_guard<std::mutex> lock(mutex_);
    workerPath_ = std::move(path);
}

bool JobManager::workerAvailable() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return !workerPath_.empty() && std::filesystem::exists(workerPath_);
}

std::wstring JobManager::workerPath() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return workerPath_;
}

std::string JobManager::startJob(const std::string& requestJsonUtf8, std::string& outError) {
    // リクエストの妥当性を先に検証（不正JSONを起動前に拒否）
    try {
        (void)nlohmann::json::parse(requestJsonUtf8);
    } catch (const std::exception& e) {
        outError = std::string("リクエストJSONが不正です: ") + e.what();
        return "";
    }
    std::unique_ptr<Job> job;
    std::string jobId;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jobId = "job-" + std::to_string(++nextId_);
        job = std::make_unique<Job>(workerPath_, jobObject_);
    }
    if (!job->start(requestJsonUtf8, outError)) return "";
    {
        std::lock_guard<std::mutex> lock(mutex_);
        jobs_[jobId] = std::move(job);
    }
    return jobId;
}

JobStatusSnapshot JobManager::getStatus(const std::string& jobId) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto it = jobs_.find(jobId);
    if (it == jobs_.end()) {
        JobStatusSnapshot s;
        s.state = JobState::Failed;
        s.errorCode = "WORKER_PROTOCOL_ERROR";
        s.errorMessage = "未知のjobId: " + jobId;
        return s;
    }
    return it->second->status();
}

std::string JobManager::getResult(const std::string& jobId) {
    return getStatus(jobId).resultJson;
}

bool JobManager::cancelJob(const std::string& jobId) {
    std::unique_ptr<Job>* job = nullptr;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto it = jobs_.find(jobId);
        if (it == jobs_.end()) return false;
        job = &it->second;
    }
    (*job)->cancel();
    return true;
}

bool JobManager::disposeJob(const std::string& jobId) {
    std::unique_ptr<Job> extracted;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto it = jobs_.find(jobId);
        if (it == jobs_.end()) return false;
        extracted = std::move(it->second);
        jobs_.erase(it);
    }
    extracted->dispose();
    return true;
}

void JobManager::disposeAll() {
    std::map<std::string, std::unique_ptr<Job>> extracted;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        extracted.swap(jobs_);
    }
    for (auto& [id, job] : extracted) job->dispose();
}

}  // namespace kazucut::addon

#endif  // _WIN32
