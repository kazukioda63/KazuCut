cmake_minimum_required(VERSION 3.24)
project(KazuCutAddon CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT WIN32)
    message(STATUS "KazuCutAddonはWindows専用です。このプラットフォームではスキップします。")
    return()
endif()

# UXP Hybrid Plugin SDKの検出（SDK_SETUP_REQUIRED.md参照。SDKを捏造しない）
set(UXP_HYBRID_SDK_CANDIDATES
    "$ENV{ADOBE_UXP_HYBRID_SDK}"
    "C:/Adobe/UXPHybridSDK"
    "C:/SDK/AdobeUXPHybrid"
    "$ENV{USERPROFILE}/AdobeUXPHybridSDK"
)
set(UXP_HYBRID_SDK_DIR "" CACHE PATH "UXP Hybrid Plugin SDKのルート")
if(UXP_HYBRID_SDK_DIR STREQUAL "")
    foreach(candidate IN LISTS UXP_HYBRID_SDK_CANDIDATES)
        if(NOT candidate STREQUAL "" AND EXISTS "${candidate}")
            set(UXP_HYBRID_SDK_DIR "${candidate}")
            break()
        endif()
    endforeach()
endif()

find_path(UXP_ADDON_INCLUDE_DIR
    NAMES UxpAddon.h
    PATHS "${UXP_HYBRID_SDK_DIR}"
    PATH_SUFFIXES include headers src
)

if(NOT UXP_ADDON_INCLUDE_DIR)
    message(FATAL_ERROR
        "UXP Hybrid Plugin SDK (UxpAddon.h) が見つかりません。\n"
        "SDK_SETUP_REQUIRED.md の手順でSDKを配置し、必要なら\n"
        "  cmake -DUXP_HYBRID_SDK_DIR=<SDKパス> ...\n"
        "を指定してください。")
endif()

# Worker側の共有部（nlohmann/json）
set(WORKER_THIRD_PARTY "${CMAKE_CURRENT_SOURCE_DIR}/../worker/third_party")

add_library(kazucut-native SHARED
    src/addon_main.cpp
    src/job_manager.cpp
)
target_include_directories(kazucut-native PRIVATE
    include
    "${UXP_ADDON_INCLUDE_DIR}"
    "${WORKER_THIRD_PARTY}"
)
target_compile_definitions(kazucut-native PRIVATE UNICODE _UNICODE)
set_target_properties(kazucut-native PROPERTIES
    OUTPUT_NAME "kazucut-native"
    SUFFIX ".uxpaddon"
)
