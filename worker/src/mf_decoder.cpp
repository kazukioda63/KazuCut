// Media Foundation デコーダ実装（Windows専用・仕様21章）。
// このファイルはWindows実機でのみビルド・検証可能（現在未検証）。

#if defined(_WIN32)

#include "kazucut/mf_decoder.hpp"

#include <windows.h>

#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>

#include <sstream>
#include <string>
#include <vector>

#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "ole32.lib")

namespace kazucut {

namespace {

std::string hresultToString(HRESULT hr) {
    std::ostringstream ss;
    ss << "HRESULT=0x" << std::hex << static_cast<unsigned long>(hr);
    return ss.str();
}

// RAII: CoInitializeEx / MFStartup（仕様21.1）
class MfSession {
public:
    HRESULT init() {
        hrCo_ = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (FAILED(hrCo_) && hrCo_ != RPC_E_CHANGED_MODE) return hrCo_;
        hrMf_ = MFStartup(MF_VERSION, MFSTARTUP_LITE);
        return hrMf_;
    }
    ~MfSession() {
        if (SUCCEEDED(hrMf_)) MFShutdown();
        if (SUCCEEDED(hrCo_)) CoUninitialize();
    }

private:
    HRESULT hrCo_ = E_FAIL;
    HRESULT hrMf_ = E_FAIL;
};

template <typename T>
class ComPtr {
public:
    ComPtr() = default;
    ~ComPtr() { reset(); }
    ComPtr(const ComPtr&) = delete;
    ComPtr& operator=(const ComPtr&) = delete;
    T** put() {
        reset();
        return &ptr_;
    }
    T* get() const { return ptr_; }
    T* operator->() const { return ptr_; }
    explicit operator bool() const { return ptr_ != nullptr; }
    void reset() {
        if (ptr_) {
            ptr_->Release();
            ptr_ = nullptr;
        }
    }

private:
    T* ptr_ = nullptr;
};

std::wstring utf8ToWide(const std::string& s) {
    if (s.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), n);
    while (!w.empty() && w.back() == L'\0') w.pop_back();
    return w;
}

}  // namespace

DecodeResult MediaFoundationAudioDecoder::decode(const DecodeRequest& request,
                                                 const ChunkCallback& onChunk,
                                                 std::stop_token stopToken) {
    DecodeResult result;
    MfSession session;
    HRESULT hr = session.init();
    if (FAILED(hr)) {
        result.error = {"AUDIO_DECODE_FAILED", "MFStartup失敗: " + hresultToString(hr)};
        return result;
    }

    // Source Reader作成（日本語・スペースパス対応: ワイド文字列で渡す）
    ComPtr<IMFSourceReader> reader;
    const std::wstring widePath = utf8ToWide(request.mediaPath);
    hr = MFCreateSourceReaderFromURL(widePath.c_str(), nullptr, reader.put());
    if (FAILED(hr)) {
        result.error = {hr == HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) ? "MEDIA_NOT_FOUND"
                                                                       : "AUDIO_DECODE_FAILED",
                        "MFCreateSourceReaderFromURL失敗: " + hresultToString(hr)};
        return result;
    }

    // 音声ストリーム選択
    hr = reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_ALL_STREAMS), FALSE);
    if (FAILED(hr)) {
        result.error = {"AUDIO_DECODE_FAILED", "SetStreamSelection失敗: " + hresultToString(hr)};
        return result;
    }
    const DWORD streamIndex =
        static_cast<DWORD>(MF_SOURCE_READER_FIRST_AUDIO_STREAM) + 0;  // 初期版: 先頭音声ストリーム
    hr = reader->SetStreamSelection(streamIndex, TRUE);
    if (FAILED(hr)) {
        result.error = {"AUDIO_STREAM_NOT_FOUND",
                        "音声ストリームを選択できません: " + hresultToString(hr)};
        return result;
    }

    // 出力形式: f32 PCM 16kHz mono（仕様21.2。MFのリサンプラMFTが挿入される）
    ComPtr<IMFMediaType> outType;
    hr = MFCreateMediaType(outType.put());
    if (SUCCEEDED(hr)) hr = outType->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
    if (SUCCEEDED(hr)) hr = outType->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
    if (SUCCEEDED(hr)) hr = outType->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 1);
    if (SUCCEEDED(hr))
        hr = outType->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND,
                                static_cast<UINT32>(kAnalysisSampleRate));
    if (SUCCEEDED(hr)) hr = outType->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 32);
    if (SUCCEEDED(hr)) hr = reader->SetCurrentMediaType(streamIndex, nullptr, outType.get());
    if (FAILED(hr)) {
        result.error = {"AUDIO_DECODE_FAILED",
                        "出力メディアタイプ設定失敗: " + hresultToString(hr)};
        return result;
    }

    // Seek（不正確前提・仕様21.3）
    const bool ranged = request.endHns > request.startHns;
    if (ranged && request.startHns > 0) {
        PROPVARIANT var;
        PropVariantInit(&var);
        var.vt = VT_I8;
        var.hVal.QuadPart = request.startHns;
        hr = reader->SetCurrentPosition(GUID_NULL, var);
        PropVariantClear(&var);
        if (FAILED(hr)) {
            result.error = {"AUDIO_SEEK_FAILED", "SetCurrentPosition失敗: " + hresultToString(hr)};
            return result;
        }
    }

    bool firstSample = true;
    for (;;) {
        if (stopToken.stop_requested()) {
            result.error = {"CANCELLED", "デコード中にキャンセル"};
            return result;
        }
        DWORD flags = 0;
        LONGLONG timestamp = 0;
        ComPtr<IMFSample> sample;
        hr = reader->ReadSample(streamIndex, 0, nullptr, &flags, &timestamp, sample.put());
        if (FAILED(hr)) {
            result.error = {"AUDIO_DECODE_FAILED", "ReadSample失敗: " + hresultToString(hr)};
            return result;
        }
        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) break;
        if (flags & MF_SOURCE_READERF_STREAMTICK) continue;  // Stream Tick処理（仕様21.3）
        if (!sample) continue;  // NULL Sample処理（仕様21.3）

        LONGLONG sampleTime = 0;
        LONGLONG sampleDuration = 0;
        if (FAILED(sample->GetSampleTime(&sampleTime))) sampleTime = timestamp;
        if (FAILED(sample->GetSampleDuration(&sampleDuration))) sampleDuration = 0;

        if (firstSample && ranged) {
            // Seek誤差を記録（仕様21.3）
            result.seekErrorHns = sampleTime - request.startHns;
            firstSample = false;
        }

        // 要求範囲後は終了
        if (ranged && sampleTime >= request.endHns) break;

        ComPtr<IMFMediaBuffer> buffer;
        hr = sample->ConvertToContiguousBuffer(buffer.put());
        if (FAILED(hr)) {
            result.error = {"AUDIO_DECODE_FAILED",
                            "ConvertToContiguousBuffer失敗: " + hresultToString(hr)};
            return result;
        }
        BYTE* data = nullptr;
        DWORD length = 0;
        hr = buffer->Lock(&data, nullptr, &length);
        if (FAILED(hr)) {
            result.error = {"AUDIO_DECODE_FAILED", "Buffer Lock失敗: " + hresultToString(hr)};
            return result;
        }
        const float* f32 = reinterpret_cast<const float*>(data);
        size_t count = length / sizeof(float);

        // Sample途中Crop（仕様21.3）: 開始前・終了後の部分を100nsベースで除外
        size_t skipFront = 0;
        if (ranged && sampleTime < request.startHns) {
            skipFront = static_cast<size_t>((request.startHns - sampleTime) *
                                            kAnalysisSampleRate / 10'000'000);
            skipFront = std::min(skipFront, count);
        }
        size_t keep = count - skipFront;
        if (ranged && sampleDuration > 0) {
            const LONGLONG sampleEnd = sampleTime + sampleDuration;
            if (sampleEnd > request.endHns) {
                const size_t skipBack = static_cast<size_t>(
                    (sampleEnd - request.endHns) * kAnalysisSampleRate / 10'000'000);
                keep = keep > skipBack ? keep - skipBack : 0;
            }
        }

        if (keep > 0) {
            AudioChunk chunk;
            chunk.sampleOffset = result.totalSamples;
            chunk.samples.assign(f32 + skipFront, f32 + skipFront + keep);
            result.totalSamples += static_cast<int64_t>(keep);
            buffer->Unlock();
            onChunk(chunk);
        } else {
            buffer->Unlock();
        }
    }

    result.ok = true;
    return result;
}

}  // namespace kazucut

#endif  // _WIN32
