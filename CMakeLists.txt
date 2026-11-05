cmake_minimum_required(VERSION 3.24)
project(Iec61850ServiceStudio LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_PYTHON_BINDINGS OFF CACHE BOOL "" FORCE)
add_subdirectory(third_party/libiec61850 EXCLUDE_FROM_ALL)
find_package(Protobuf CONFIG REQUIRED)
find_package(gRPC CONFIG REQUIRED)
set(GENERATED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/backend/generated")
add_executable(iec61850-service-backend backend/src/main.cpp backend/src/tls_context.cpp backend/src/setting_store.cpp backend/src/publisher_service.cpp backend/src/publisher_model.cpp backend/src/server_engine.cpp backend/src/model_builder.cpp backend/src/model_browser.cpp backend/src/control_handlers.cpp backend/src/project_validation.cpp backend/src/engine_operations.cpp "${GENERATED_DIR}/service.pb.cc" "${GENERATED_DIR}/service.grpc.pb.cc")
target_include_directories(iec61850-service-backend PRIVATE "${GENERATED_DIR}")
target_link_libraries(iec61850-service-backend PRIVATE gRPC::grpc++ protobuf::libprotobuf iec61850)
if(MSVC)
  target_link_libraries(iec61850-service-backend PRIVATE delayimp)
  target_link_options(iec61850-service-backend PRIVATE "/DELAYLOAD:wpcap.dll")
endif()
add_executable(mms-integration backend/tests/mms_integration.cpp)
target_link_libraries(mms-integration PRIVATE iec61850)
add_executable(security-integration backend/tests/security_integration.cpp)
target_link_libraries(security-integration PRIVATE iec61850)
add_executable(capture-integration backend/tests/capture_integration.cpp)
target_link_libraries(capture-integration PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libiec61850/third_party/winpcap/Lib/wpcap.lib")
foreach(target iec61850-service-backend mms-integration security-integration capture-integration)
  target_include_directories(${target} PRIVATE
    third_party/libiec61850/src/iec61850/inc third_party/libiec61850/src/common/inc
    third_party/libiec61850/src/mms/inc third_party/libiec61850/hal/inc
    third_party/libiec61850/src/r_session third_party/libiec61850/src/goose third_party/libiec61850/src/sampled_values
    third_party/libiec61850/third_party/winpcap/Include
    third_party/libiec61850/src/logging third_party/libiec61850/config)
  target_compile_definitions(${target} PRIVATE CONFIG_MMS_SUPPORT_TLS=1 NOMINMAX _WIN32_WINNT=0x0A00)
  set_target_properties(${target} PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/backend/bin")
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /utf-8)
  endif()
endforeach()




