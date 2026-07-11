cmake_minimum_required(VERSION 3.24)
project(KazuCutWorker CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

option(KAZUCUT_ENABLE_WHISPER "whisper.cpp統合を有効化（Phase 9・要whisper.cpp）" OFF)
option(KAZUCUT_BUILD_TESTS "Catch2ユニットテストをビルド" ON)

# 解析コア（移植可能。Addon内Worker Threadフォールバック時もこれをリンクする: ADR-001）
add_library(kazucut_core STATIC
    src/wav_decoder.cpp
    src/silence_detector.cpp
    src/job_runner.cpp
)
target_include_directories(kazucut_core PUBLIC include third_party)
if(WIN32)
    target_sources(kazucut_core PRIVATE src/mf_decoder.cpp)
    target_compile_definitions(kazucut_core PRIVATE UNICODE _UNICODE)
    target_link_libraries(kazucut_core PUBLIC mf mfplat mfreadwrite mfuuid ole32)
endif()
if(KAZUCUT_ENABLE_WHISPER)
    # whisper.cppはFetchContentでCommit固定取得（Phase 9で有効化。THIRD_PARTY_NOTICES.md参照）
    include(FetchContent)
    FetchContent_Declare(whisper
        GIT_REPOSITORY https://github.com/ggml-org/whisper.cpp.git
        GIT_TAG v1.7.4
    )
    FetchContent_MakeAvailable(whisper)
    target_link_libraries(kazucut_core PUBLIC whisper)
    target_compile_definitions(kazucut_core PUBLIC KAZUCUT_ENABLE_WHISPER)
endif()

add_executable(KazuCutWorker src/main.cpp)
target_link_libraries(KazuCutWorker PRIVATE kazucut_core)
if(NOT WIN32)
    find_package(Threads REQUIRED)
    target_link_libraries(KazuCutWorker PRIVATE Threads::Threads)
endif()

if(KAZUCUT_BUILD_TESTS)
    enable_testing()
    add_library(catch2 STATIC third_party/catch2/catch_amalgamated.cpp)
    target_include_directories(catch2 PUBLIC third_party)
    add_executable(worker_tests
        tests/test_silence_detector.cpp
        tests/test_wav_decoder.cpp
        tests/test_protocol.cpp
    )
    target_link_libraries(worker_tests PRIVATE kazucut_core catch2)
    add_test(NAME worker_tests COMMAND worker_tests)
endif()
