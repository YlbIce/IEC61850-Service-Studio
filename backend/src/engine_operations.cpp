#include "server_engine.h"

void ServerEngine::Apply(const studio_proto::Project *p, studio_proto::Reply *r) {
    std::lock_guard<std::mutex> l(op);
    try {
        if (running) {
            r->set_message("Stop the server before applying a project");
            return;
        }
        auto err = validate(*p);
        if (!err.empty()) {
            r->set_message(err);
            return;
        }
        IedModel *parsed = nullptr;
        if (!p->config_path().empty()) {
            parsed = ConfigFileParser_createModelFromConfigFileEx(p->config_path().c_str());
            if (!parsed || !parsed->firstChild) {
                if (parsed)
                    IedModel_destroy(parsed);
                r->set_message("CFG parser rejected the model");
                return;
            }
        }
        {
            std::lock_guard<std::recursive_mutex> d(data);
            build(*p, parsed);
        }
        event("PROJECT", "Applied " + p->name());
        r->set_ok(true);
        r->set_message("Project applied");
        return;
    } catch (const std::exception &e) {
        std::lock_guard<std::recursive_mutex> d(data);
        clear();
        points.clear();
        reports.clear();
        r->set_message(std::string("Model construction failed: ") + e.what());
        return;
    }
}

void ServerEngine::Start(const studio_proto::Empty *, studio_proto::Reply *r) {
    std::lock_guard<std::mutex> l(op);
    if (!ied) {
        r->set_message("Apply a project first");
        return;
    }
    if (!running) {
        IedServer_start(ied, project.port());
        if (IedServer_isRunning(ied)) {
            IedServer_lockDataModel(ied);
            try {
                publishers.start();
            } catch (...) {
                IedServer_unlockDataModel(ied);
                IedServer_stop(ied);
                throw;
            }
            IedServer_unlockDataModel(ied);
        }
        {
            std::lock_guard<std::recursive_mutex> d(data);
            running = IedServer_isRunning(ied);
            if (running)
                started = now();
        }
        event("SERVER",
              running ? "MMS listening on " + project.host() + ":" + std::to_string(project.port())
                      : "MMS bind failed; check address, port conflict and permissions",
              running ? "INFO" : "ERROR");
    }
    r->set_ok(running);
    r->set_message(running ? "MMS server started" : "Cannot bind MMS port");
    return;
}

void ServerEngine::Stop(const studio_proto::Empty *, studio_proto::Reply *r) {
    std::lock_guard<std::mutex> l(op);
    stop();
    event("SERVER", "MMS stopped");
    r->set_ok(true);
    return;
}

void ServerEngine::Update(const studio_proto::UpdateRequest *q, studio_proto::Reply *r) {
    std::lock_guard<std::mutex> l(op);
    auto it = std::find_if(points.begin(), points.end(), [&](auto &n) { return n->ref == q->reference(); });
    if (it == points.end() || !validValue((*it)->spec.cdc(), q->value()) || q->quality() > 8191) {
        r->set_message("Invalid point, value or quality");
        return;
    }
    IedServer_lockDataModel(ied);
    {
        std::lock_guard<std::recursive_mutex> d(data);
        (*it)->blocked = q->blocked();
        setValue(**it, q->value(), q->quality());
        eventLocked("VALUE", q->reference() + " = " + std::to_string(q->value()) +
                                 " q=" + std::to_string(q->quality()));
    }
    IedServer_unlockDataModel(ied);
    r->set_ok(true);
    return;
}

void ServerEngine::Simulation(const studio_proto::SimulationRequest *q, studio_proto::Reply *r) {
    std::lock_guard<std::mutex> l(op);
    std::lock_guard<std::recursive_mutex> d(data);
    if (!q->reference().empty()) {
        auto it = std::find_if(points.begin(), points.end(), [&](auto& n) { return n->ref == q->reference(); });
        if (it == points.end() || !std::isfinite(q->base()) || !std::isfinite(q->amplitude()) ||
            !std::isfinite(q->period()) || q->period() < 0.2 || std::abs(q->amplitude()) > 1e20 ||
            (q->waveform() != "constant" && q->waveform() != "sine" && q->waveform() != "ramp" && q->waveform() != "square") ||
            (*it)->spec.cdc() == "SPC" || (*it)->spec.cdc() == "DPC" || !validValue((*it)->spec.cdc(), q->base())) {
            r->set_message("Invalid waveform configuration or control output"); return;
        }
        auto& spec = (*it)->spec;
        spec.set_value(q->base()); spec.set_waveform(q->waveform());
        spec.set_amplitude(q->amplitude()); spec.set_period(q->period());
        r->set_ok(true); return;
    }
    if (q->enabled() && std::none_of(points.begin(), points.end(), [](auto& n) {
        return n->spec.waveform() != "constant" && n->spec.cdc() != "SPC" && n->spec.cdc() != "DPC" &&
            (n->spec.cdc() == "SPS" || n->spec.amplitude() != 0);
    })) { r->set_message("没有有效波形，请在数值仿真页双击点位配置波形和幅值"); return; }
    if (!running) {
        r->set_message("Start MMS before simulation");
        return;
    }
    simulation = q->enabled();
    eventLocked("SIMULATION", simulation ? "Waveforms started (100 ms tick)" : "Waveforms paused");
    r->set_ok(true);
    return;
}

void ServerEngine::Snapshot(const studio_proto::Empty *, studio_proto::State *s) {
    std::lock_guard<std::recursive_mutex> d(data);
    publishers.snapshot(s);
    s->set_tls(project.tls().enabled());
    s->set_running(running);
    s->set_configured(ied != nullptr);
    s->set_simulation(simulation);
    s->set_started_at(started);
    s->set_updates(updates);
    s->set_controls(controls);
    s->set_library_version(LibIEC61850_getVersionString());
    for (auto &n : points) {
        auto *v = s->add_points();
        v->set_reference(n->ref);
        v->set_value(n->current);
        v->set_quality(n->q);
        v->set_timestamp(n->timestamp);
        v->set_blocked(n->blocked);
        v->set_waveform(n->spec.waveform()); v->set_amplitude(n->spec.amplitude());
        v->set_period(n->spec.period()); v->set_base(n->spec.value());
    }
    for (auto &e : events)
        *s->add_events() = e;
    for (auto &pair : sessions)
        *s->add_sessions() = pair.second;
    for (auto &pair : reports)
        *s->add_reports() = pair.second;
    return;
}

void ServerEngine::Interfaces(const studio_proto::Empty *, studio_proto::InterfaceList *result) {
    PublisherService::interfaces(result);
}
void ServerEngine::Settings(const studio_proto::Empty *, studio_proto::SettingState *result) {
    std::lock_guard<std::mutex> lock(op);
    if (!ied || !settings)
        return;
    IedServer_lockDataModel(ied);
    *result = settings->snapshot();
    IedServer_unlockDataModel(ied);
}
void ServerEngine::ChangeSetting(const studio_proto::SettingRequest *request, studio_proto::Reply *reply) {
    std::lock_guard<std::mutex> lock(op);
    if (!ied || !settings)
        throw std::runtime_error("No setting model loaded");
    IedServer_lockDataModel(ied);
    try {
        settings->change(*request);
    } catch (...) {
        IedServer_unlockDataModel(ied);
        throw;
    }
    IedServer_unlockDataModel(ied);
    reply->set_ok(true);
    event("SETTING", request->reference() + " bank=" + std::to_string(request->bank()) +
                         (request->activate() ? " activated" : " committed"));
}
