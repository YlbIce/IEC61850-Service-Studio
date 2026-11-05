#include "server_engine.h"

CheckHandlerResult ServerEngine::checkControl(ControlAction action, void *param, MmsValue *value, bool test,
                                              bool) {
    auto &p = *static_cast<Point *>(param);
    auto &s = *p.owner;
    std::lock_guard<std::recursive_mutex> l(s.data);
    const bool typeValid = value ? MmsValue_getType(value) == MMS_BOOLEAN : ControlAction_isSelect(action);
    if (test || p.blocked || !s.project.allow_controls() || !typeValid) {
        s.eventLocked("CONTROL", p.ref + " check rejected (test / blocked / policy / type)", "WARN");
        return CONTROL_OBJECT_ACCESS_DENIED;
    }
    return CONTROL_ACCEPTED;
}

ControlHandlerResult ServerEngine::control(ControlAction, void *param, MmsValue *v, bool test) {
    auto &p = *static_cast<Point *>(param);
    auto &s = *p.owner;
    std::lock_guard<std::recursive_mutex> l(s.data);
    if (test || p.blocked || !s.project.allow_controls() || MmsValue_getType(v) != MMS_BOOLEAN) {
        s.eventLocked("CONTROL", p.ref + " operate rejected (test / blocked / policy / type)", "WARN");
        return CONTROL_RESULT_FAILED;
    }
    bool on = MmsValue_getBoolean(v);
    s.setValue(p, p.spec.cdc() == "DPC" ? (on ? 2 : 1) : (on ? 1 : 0), p.q);
    ++s.controls;
    s.eventLocked("CONTROL", p.ref + " operate accepted: " + (on ? "ON" : "OFF"));
    return CONTROL_RESULT_OK;
}

void ServerEngine::selection(ControlAction, void *param, bool selected, SelectStateChangedReason) {
    auto &p = *static_cast<Point *>(param);
    p.owner->event("CONTROL", p.ref + (selected ? " selected" : " selection released"));
}

void ServerEngine::connection(IedServer, ClientConnection c, bool connected, void *param) {
    auto &s = *static_cast<ServerEngine *>(param);
    const char *address = ClientConnection_getPeerAddress(c);
    std::string peer = address ? address : "unknown";
    std::lock_guard<std::recursive_mutex> l(s.data);
    if (connected) {
        auto &item = s.sessions[peer];
        item.set_address(peer);
        item.set_since(now());
    } else
        s.sessions.erase(peer);
    s.eventLocked("SESSION", peer + (connected ? " connected" : " disconnected"));
}

void ServerEngine::report(void *param, ReportControlBlock *rcb, ClientConnection c, IedServer_RCBEventType e,
                          const char *name, MmsDataAccessError error) {
    auto &s = *static_cast<ServerEngine *>(param);
    std::lock_guard<std::recursive_mutex> l(s.data);
    auto &r = s.reports[rcb];
    if (e == RCB_EVENT_ENABLE) {
        r.set_enabled(true);
        r.set_owner(c ? ClientConnection_getPeerAddress(c) : "");
    }
    if (e == RCB_EVENT_DISABLE || e == RCB_EVENT_UNRESERVED) {
        r.set_enabled(false);
        r.clear_owner();
    }
    if (e == RCB_EVENT_REPORT_CREATED) {
        r.set_events(r.events() + 1);
        return;
    }
    static const char *labels[] = {"read",     "configure", "unreserved", "reserved", "enabled",
                                   "disabled", "GI",        "purge",      "overflow", "created"};
    std::string label = e >= 0 && e <= 9 ? labels[e] : "event";
    s.eventLocked("REPORT",
                  r.name() + " " + label + (name ? " " + std::string(name) : "") +
                      " result=" + std::to_string(error),
                  e == RCB_EVENT_OVERFLOW ? "WARN" : "INFO");
}
