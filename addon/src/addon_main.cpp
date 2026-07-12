// UXP Hybrid Addon エントリポイント（kazucut-native.uxpaddon）
//
// SDKヘッダーは addon/third_party/uxp/ にベンダリング済み
// （Adobe著作・再配布許諾表記あり。入手経路はTHIRD_PARTY_NOTICES.md参照）。
// API呼び出しは実ヘッダー（UxpAddonShared.h の addon_apis / UXP_ADDON_INIT）に
// 一致させている。ビルド・Premiereロードの実機検証はWindows待ち（未検証）。

#if defined(_WIN32)

#include "UxpAddon.h"  // third_party/uxp/utilities（UXP_ADDON_INIT / UxpAddonApis / Check）

#include "kazucut_addon/job_manager.hpp"

#include <nlohmann/json.hpp>

#include <string>
#include <vector>

namespace {

constexpr const char* kAddonVersion = "0.1.0";

kazucut::addon::JobManager& manager() {
    static kazucut::addon::JobManager instance;
    return instance;
}

// Addon DLL自身の場所から同梱Workerの絶対パスを解決する（ユーザー入力不使用: 仕様8.1）
// 配置: plugin-root/win/x64/{kazucut-native.uxpaddon, KazuCutWorker.exe}
std::wstring resolveWorkerPath() {
    HMODULE self = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&resolveWorkerPath), &self);
    wchar_t buf[MAX_PATH * 4];
    const DWORD n = GetModuleFileNameW(self, buf, static_cast<DWORD>(std::size(buf)));
    if (n == 0 || n >= std::size(buf)) return L"";
    std::wstring path(buf, n);
    const size_t slash = path.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return L"";
    return path.substr(0, slash + 1) + L"KazuCutWorker.exe";
}

// ---- addon_apis ヘルパー ----

std::string getStringArg(addon_env env, addon_callback_info info) {
    size_t argc = 1;
    addon_value argv[1] = {nullptr};
    Check(UxpAddonApis.uxp_addon_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
    if (argc < 1 || argv[0] == nullptr) throw std::runtime_error("引数がありません");
    size_t len = 0;
    Check(UxpAddonApis.uxp_addon_get_value_string_utf8(env, argv[0], nullptr, 0, &len));
    std::vector<char> buf(len + 1, '\0');
    size_t copied = 0;
    Check(UxpAddonApis.uxp_addon_get_value_string_utf8(env, argv[0], buf.data(), buf.size(), &copied));
    return std::string(buf.data(), copied);
}

addon_value makeString(addon_env env, const std::string& s) {
    addon_value v = nullptr;
    Check(UxpAddonApis.uxp_addon_create_string_utf8(env, s.c_str(), s.size(), &v));
    return v;
}

addon_value makeBool(addon_env env, bool b) {
    addon_value v = nullptr;
    Check(UxpAddonApis.uxp_addon_get_boolean(env, b, &v));
    return v;
}

std::string utf8FromStatus(const kazucut::addon::JobStatusSnapshot& s) {
    using kazucut::addon::JobState;
    const char* state = "pending";
    switch (s.state) {
        case JobState::Pending: state = "pending"; break;
        case JobState::Running: state = "running"; break;
        case JobState::Completed: state = "completed"; break;
        case JobState::Failed: state = "failed"; break;
        case JobState::Cancelled: state = "cancelled"; break;
    }
    nlohmann::json j = {{"state", state}, {"progress", s.progress}, {"stage", s.stage}};
    if (s.state == JobState::Failed) {
        j["error"] = {{"code", s.errorCode}, {"developerMessage", s.errorMessage}};
    }
    return j.dump();
}

// ---- NativeBridge実装（plugin/src/types.tsと対応。すべて短時間で返る） ----
// 例外は各関数の境界で捕捉し、Premiereへ伝播させない（仕様6.3 / CreateErrorFromException）

addon_value GetVersion(addon_env env, addon_callback_info) {
    try {
        nlohmann::json j = {{"addonVersion", kAddonVersion},
                            {"workerVersion", "0.1.0"},
                            {"architecture", "windows-x64"},
                            {"workerAvailable", manager().workerAvailable()},
                            {"executionMode", "external-worker"}};
        return makeString(env, j.dump());
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value HealthCheck(addon_env env, addon_callback_info) {
    try {
        nlohmann::json j = {{"ok", true}, {"workerAvailable", manager().workerAvailable()}};
        return makeString(env, j.dump());
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value StartJob(addon_env env, addon_callback_info info) {
    try {
        const std::string request = getStringArg(env, info);
        std::string error;
        const std::string jobId = manager().startJob(request, error);
        if (jobId.empty()) {
            nlohmann::json j = {{"error",
                                 {{"code", error == "WORKER_NOT_FOUND" ? "WORKER_NOT_FOUND"
                                                                       : "WORKER_START_FAILED"},
                                  {"developerMessage", error}}}};
            return makeString(env, j.dump());
        }
        return makeString(env, jobId);
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value GetJobStatus(addon_env env, addon_callback_info info) {
    try {
        return makeString(env, utf8FromStatus(manager().getStatus(getStringArg(env, info))));
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value GetJobResult(addon_env env, addon_callback_info info) {
    try {
        return makeString(env, manager().getResult(getStringArg(env, info)));
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value CancelJob(addon_env env, addon_callback_info info) {
    try {
        return makeBool(env, manager().cancelJob(getStringArg(env, info)));
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value DisposeJob(addon_env env, addon_callback_info info) {
    try {
        return makeBool(env, manager().disposeJob(getStringArg(env, info)));
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value Init(addon_env env, addon_value exports, addon_apis /*addonAPIs*/) {
    // UXP_ADDON_INITマクロがSET_ADDON_APIS済み。以後はUxpAddonApis経由で呼ぶ
    manager().setWorkerPath(resolveWorkerPath());
    const struct {
        const char* name;
        addon_callback fn;
    } methods[] = {
        {"getVersion", GetVersion},     {"healthCheck", HealthCheck},
        {"startJob", StartJob},         {"getJobStatus", GetJobStatus},
        {"getJobResult", GetJobResult}, {"cancelJob", CancelJob},
        {"disposeJob", DisposeJob},
    };
    for (const auto& m : methods) {
        addon_value fn = nullptr;
        Check(UxpAddonApis.uxp_addon_create_function(env, m.name, strlen(m.name), m.fn, nullptr, &fn));
        Check(UxpAddonApis.uxp_addon_set_named_property(env, exports, m.name, fn));
    }
    return exports;
}

void Terminate(addon_env /*env*/) {
    // Addon終了時: 全Worker停止（Job ObjectのKILL_ON_JOB_CLOSEと二重の防御）
    manager().disposeAll();
}

}  // namespace

UXP_ADDON_INIT(Init)

UXP_ADDON_TERMINATE(Terminate)

#endif  // _WIN32
