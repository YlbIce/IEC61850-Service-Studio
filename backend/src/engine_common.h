#pragma once
#include "service.pb.h"
#include "iec61850_server.h"
#include "iec61850_config_file_parser.h"
#include "hal_time.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <regex>
#include <set>
#include <thread>

namespace studio_proto = service_studio;
inline uint64_t now() {
    return Hal_getTimeInMs();
}
inline bool id(const std::string &s) {
    return std::regex_match(s, std::regex("[A-Za-z][A-Za-z0-9_]{0,31}"));
}
inline std::string key(const studio_proto::Point &p) {
    return p.ld() + "/" + p.ln() + "." + p.name();
}
inline bool validValue(const std::string &cdc, double v) {
    if (!std::isfinite(v))
        return false;
    if (cdc == "MV")
        return std::abs(v) <= 1e30;
    if (cdc == "SPS" || cdc == "SPC")
        return v == 0 || v == 1;
    if (cdc == "DPC")
        return v >= 0 && v <= 3 && std::floor(v) == v;
    return v >= -2147483648.0 && v <= 2147483647.0 && std::floor(v) == v;
}
