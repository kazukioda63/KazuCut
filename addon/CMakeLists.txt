cmake_minimum_required(VERSION 3.24)
project(KazuCutAddon CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT WIN32)
    message(STATUS "KazuCutAddonはWindows専用です。このプラットフォームではスキップします。")
    return()
endif()

# UXP AddonヘッダーはAdobe再配布許諾付きでベンダリング済み（third_party/uxp/）。
# 外部SDKのダウンロード・配置は不要。THIRD_PARTY_NOTICES.md参照。
set(UXP_VENDORED "${CMAKE_CURRENT_SOURCE_DIR}/third_party/uxp")

# Worker側の共有部（nlohmann/json）
set(WORKER_THIRD_PARTY "${CMAKE_CURRENT_SOURCE_DIR}/../worker/third_party")

add_library(kazucut-native SHARED
    src/addon_main.cpp
    src/job_manager.cpp
    "${UXP_VENDORED}/utilities/UxpAddon.cpp"
)
target_include_directories(kazucut-native PRIVATE
    include
    "${UXP_VENDORED}/api"
    "${UXP_VENDORED}/utilities"
    "${WORKER_THIRD_PARTY}"
)
target_compile_definitions(kazucut-native PRIVATE UNICODE _UNICODE NOMINMAX)
if(MINGW)
    # mingwランタイムDLL依存を除去（配布先にlibstdc++-6.dll等は無い）
    target_link_options(kazucut-native PRIVATE -static -static-libgcc -static-libstdc++)
endif()
set_target_properties(kazucut-native PROPERTIES
    OUTPUT_NAME "kazucut-native"
    PREFIX ""
    SUFFIX ".uxpaddon"
)
