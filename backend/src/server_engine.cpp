#include "server_engine.h"

void ServerEngine::eventLocked(const std::string &category, const std::string &msg,
                               const std::string &level) {
    studio_proto::Event e;
    e.set_sequence(++sequence);
    e.set_timestamp(now());
    e.set_category(category);
    e.set_message(msg);
    e.set_level(level);
    events.push_back(e);
    if (events.size() > 2000)
        events.erase(events.begin(), events.begin() + 500);
}

void ServerEngine::event(const std::string &category, const std::string &msg, const std::string &level) {
    std::lock_guard<std::recursive_mutex> l(data);
    eventLocked(category, msg, level);
}

void ServerEngine::setValue(Point &p, double value, uint32_t q) {
    p.timestamp = now();
    p.current = value;
    p.q = q;
    IedServer_updateUTCTimeAttributeValue(ied, p.time, p.timestamp);
    IedServer_updateQuality(ied, p.quality, static_cast<Quality>(q));
    if (p.spec.cdc() == "MV")
        IedServer_updateFloatAttributeValue(ied, p.value, static_cast<float>(value));
    else if (p.spec.cdc() == "SPC" || p.spec.cdc() == "SPS")
        IedServer_updateBooleanAttributeValue(ied, p.value, value != 0);
    else if (p.spec.cdc() == "DPC")
        IedServer_updateDbposValue(ied, p.value, static_cast<Dbpos>(static_cast<int>(value)));
    else
        IedServer_updateInt32AttributeValue(ied, p.value, static_cast<int32_t>(value));
    ++updates;
}

void ServerEngine::stop() {
    publishers.stop();
    if (ied && running)
        IedServer_stop(ied);
    std::lock_guard<std::recursive_mutex> l(data);
    running = false;
    simulation = false;
    sessions.clear();
    for (auto &r : reports) {
        r.second.set_enabled(false);
        r.second.clear_owner();
    }
}

void ServerEngine::clear() {
    publishers.stop();
    settings.reset();
    if (ied) {
        IedServer_destroy(ied);
        ied = nullptr;
        tls.reset();
    }
    if (model) {
        IedModel_destroy(model);
        model = nullptr;
    }
}

ServerEngine::ServerEngine() {
    ticker = std::thread([this] {
        while (alive) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            std::lock_guard<std::mutex> l(op);
            if (!running || !simulation)
                continue;
            IedServer_lockDataModel(ied);
            {
                std::lock_guard<std::recursive_mutex> d(data);
                double t = static_cast<double>(now() - started) / 1000.0;
                for (auto &n : points) {
                    auto &x = n->spec;
                    if (x.waveform() == "constant" || x.cdc() == "SPC" || x.cdc() == "DPC")
                        continue;
                    double phase = std::fmod(t / x.period(), 1.0), value = x.value();
                    if (x.waveform() == "sine")
                        value += x.amplitude() * std::sin(phase * 6.283185307179586);
                    else if (x.waveform() == "ramp")
                        value += x.amplitude() * (2 * phase - 1);
                    else
                        value += x.amplitude() * (phase < 0.5 ? 1 : -1);
                    if (x.cdc() == "SPS")
                        value = phase < 0.5 ? 1 : 0;
                    if (x.cdc() == "INS")
                        value = std::round(value);
                    if (validValue(x.cdc(), value))
                        setValue(*n, value, n->q);
                }
            }
            IedServer_unlockDataModel(ied);
        }
    });
}

ServerEngine::~ServerEngine() {
    alive = false;
    ticker.join();
    stop();
    clear();
}
