#include "server_engine.h"

std::string ServerEngine::validate(const studio_proto::Project &p) {
    if ((p.config_path().empty() && !id(p.ied_name())) || p.port() < 1 || p.port() > 65535 ||
        p.max_clients() < 1 || p.max_clients() > 32)
        return "Invalid IED name, port or client limit";
    if (!std::regex_match(p.host(), std::regex("[0-9]{1,3}(\\.[0-9]{1,3}){3}")))
        return "IPv4 bind address required";
    if (p.file_service() && p.file_root().empty())
        return "File service root is required";
    if (!p.config_path().empty())
        return "";
    if (p.points_size() < 1 || p.points_size() > 10000 || p.datasets_size() > 128 || p.reports_size() > 128)
        return "Model limits exceeded";
    std::set<std::string> refs, ds, rc;
    for (const auto &x : p.points()) {
        if (!id(x.ld()) || !id(x.ln()) || !id(x.name()) || p.ied_name().size() + x.ld().size() > 64)
            return "Invalid point identifier";
        if (x.cdc() != "MV" && x.cdc() != "SPS" && x.cdc() != "INS" && x.cdc() != "SPC" && x.cdc() != "DPC")
            return "Unsupported CDC";
        if (!refs.insert(key(x)).second || !validValue(x.cdc(), x.value()) || x.quality() > 8191)
            return "Duplicate point or invalid value / quality";
        if ((x.cdc() == "SPC" || x.cdc() == "DPC") && (x.control_model() < 1 || x.control_model() > 4))
            return "Invalid control model";
        if (!std::isfinite(x.amplitude()) || std::abs(x.amplitude()) > 1e20 || !std::isfinite(x.period()) ||
            x.period() < 0.2)
            return "Invalid waveform parameters";
        if (x.waveform() != "constant" && x.waveform() != "sine" && x.waveform() != "ramp" &&
            x.waveform() != "square")
            return "Invalid waveform";
    }
    for (const auto &d : p.datasets()) {
        if (!id(d.ld()) || !id(d.ln()) || !id(d.name()) ||
            !ds.insert(d.ld() + "/" + d.ln() + "." + d.name()).second || d.members_size() < 1 ||
            d.members_size() > 256)
            return "Invalid dataset";
        for (auto &m : d.members())
            if (!refs.count(m) || m.rfind(d.ld() + "/", 0) != 0)
                return "Dataset must reference existing points in its logical device";
    }
    for (const auto &r : p.reports()) {
        if (!id(r.name()) || !ds.count(r.ld() + "/" + r.ln() + "." + r.dataset()) ||
            !rc.insert(r.ld() + "/" + r.ln() + "." + r.name()).second || r.buffer_ms() > 60000 ||
            r.integrity_ms() > 86400000 || r.triggers() > 31 || r.conf_rev() < 1)
            return "Invalid report configuration";
    }
    if (p.file_service() && p.file_root().empty())
        return "File service root is required";
    return "";
}
