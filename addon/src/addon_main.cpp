// UXP Hybrid Addon エントリポイント（kazucut-native.uxpaddon）
//
// ⚠️ SDK未取得のためこのファイルは一度もコンパイルされていない（SDK_SETUP_REQUIRED.md）。
// UXP Hybrid Plugin SDKのAPIは「Node-APIに意図的に類似」と公式に説明されており
// （docs/REFERENCES.md参照）、本ファイルはNode-API互換のシグネチャで記述している。
// SDK配置後の初回ビルドで、SDK付属ヘッダー（UxpAddon.h / UxpAddonShared.h /
// UxpAddonTypes.h）およびサンプルと突き合わせてシグネチャを確定すること。
// 差異が出た場合はこのファイルのみ修正すればよい（ロジックはjob_manager.cppに分離済み）。

#if defined(_WIN32)

#include "UxpAddon.h"        // SDK付属（UXP_ADDON_INIT / UXP_ADDON_TERMINATE）
#include "UxpAddonShared.h"  // SDK付属（Node-API類似のaddon API）

#include "kazucut_addon/job_manager.hpp"

#include <nlohmann/json.hpp>

#include <string>

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

// ---- Node-API類似ヘルパー（SDKヘッダーの実シグネチャに合わせて調整すること） ----

std::string getStringArg(addon_env env, addon_callback_info info) {
    size_t argc = 1;
    addon_value argv[1];
    check_status(env, addon_get_cb_info(env, info, &argc, argv, nullptr, nullptr));
    size_t len = 0;
    check_status(env, addon_get_value_string_utf8(env, argv[0], nullptr, 0, &len));
    std::string out(len, '\0');
    check_status(env, addon_get_value_string_utf8(env, argv[0], out.data(), len + 1, &len));
    return out;
}

addon_value makeString(addon_env env, const std::string& s) {
    addon_value v;
    check_status(env, addon_create_string_utf8(env, s.c_str(), s.size(), &v));
    return v;
}

addon_value makeBool(addon_env env, bool b) {
    addon_value v;
    check_status(env, addon_get_boolean(env, b, &v));
    return v;
}

// ---- NativeBridge実装（plugin/src/types.tsと対応。すべて短時間で返る） ----

addon_value GetVersion(addon_env env, addon_callback_info) {
    try {
        nlohmann::json j = {{"addonVersion", kAddonVersion},
                            {"workerVersion", "0.1.0"},
                            {"architecture", "windows-x64"},
                            {"workerAvailable", manager().workerAvailable()},
                            {"executionMode", "external-worker"}};
        return makeString(env, j.dump());
    } catch (const std::exception& e) {
        // 例外でPremiereを落とさない（仕様6.3）
        return makeString(env, std::string("{\"error\":\"") + e.what() + "\"}");
    }
}

addon_value HealthCheck(addon_env env, addon_callback_info) {
    try {
        nlohmann::json j = {{"ok", true}, {"workerAvailable", manager().workerAvailable()}};
        return makeString(env, j.dump());
    } catch (const std::exception&) {
        return makeString(env, "{\"ok\":false}");
    }
}

addon_value StartJob(addon_env env, addon_callback_info info) {
    try {
        const std::string request = getStringArg(env, info);
        std::string error;
        const std::string jobId = manager().startJob(request, error);
        if (jobId.empty()) {
            nlohmann::json j = {{"error", {{"code", error == "WORKER_NOT_FOUND"
                                                       ? "WORKER_NOT_FOUND"
                                                       : "WORKER_START_FAILED"},
                                           {"developerMessage", error}}}};
            return makeString(env, j.dump());
        }
        return makeString(env, jobId);
    } catch (const std::exception& e) {
        nlohmann::json j = {{"error", {{"code", "WORKER_START_FAILED"},
                                       {"developerMessage", e.what()}}}};
        return makeString(env, j.dump());
    }
}

addon_value GetJobStatus(addon_env env, addon_callback_info info) {
    try {
        return makeString(env, utf8FromStatus(manager().getStatus(getStringArg(env, info))));
    } catch (const std::exception& e) {
        nlohmann::json j = {{"state", "failed"},
                            {"progress", 0},
                            {"error", {{"code", "WORKER_PROTOCOL_ERROR"},
                                       {"developerMessage", e.what()}}}};
        return makeString(env, j.dump());
    }
}

addon_value GetJobResult(addon_env env, addon_callback_info info) {
    try {
        return makeString(env, manager().getResult(getStringArg(env, info)));
    } catch (const std::exception&) {
        return makeString(env, "{}");
    }
}

addon_value CancelJob(addon_env env, addon_callback_info info) {
    try {
        return makeBool(env, manager().cancelJob(getStringArg(env, info)));
    } catch (const std::exception&) {
        return makeBool(env, false);
    }
}

addon_value DisposeJob(addon_env env, addon_callback_info info) {
    try {
        return makeBool(env, manager().disposeJob(getStringArg(env, info)));
    } catch (const std::exception&) {
        return makeBool(env, false);
    }
}

addon_value Init(addon_env env, addon_value exports) {
    manager().setWorkerPath(resolveWorkerPath());
    const struct {
        const char* name;
        addon_value (*fn)(addon_env, addon_callback_info);
    } methods[] = {
        {"getVersion", GetVersion},   {"healthCheck", HealthCheck},
        {"startJob", StartJob},       {"getJobStatus", GetJobStatus},
        {"getJobResult", GetJobResult}, {"cancelJob", CancelJob},
        {"disposeJob", DisposeJob},
    };
    for (const auto& m : methods) {
        addon_value fn;
        check_status(env, addon_create_function(env, m.name, ADDON_AUTO_LENGTH, m.fn, nullptr, &fn));
        check_status(env, addon_set_named_property(env, exports, m.name, fn));
    }
    return exports;
}

}  // namespace

UXP_ADDON_INIT(Init)

UXP_ADDON_TERMINATE() {
    // Addon終了時: 全Worker停止（Job ObjectのKILL_ON_JOB_CLOSEと二重の防御）
    manager().disposeAll();
}

#endif  // _WIN32
