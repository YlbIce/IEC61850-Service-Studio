#pragma once
#include "engine_common.h"
#include <functional>

// All calls hold the IED model lock; this store owns durable banks, never transport.
class SettingStore {
    struct Device {
        SettingGroupControlBlock *block;
        std::vector<DataAttribute *> active, edit;
    };
    IedServer server;
    std::string path;
    studio_proto::SettingState state;
    std::vector<Device> devices;
    void persist(const studio_proto::SettingState &next);
    void load(size_t device, unsigned bank, bool edit);
    size_t index(SettingGroupControlBlock *block) const;
    static bool activate(void *, SettingGroupControlBlock *, uint8_t, ClientConnection);
    static bool edit(void *, SettingGroupControlBlock *, uint8_t, ClientConnection);
    static bool confirm(void *, SettingGroupControlBlock *, uint8_t);

  public:
    SettingStore(IedServer server, IedModel *model, std::string path);
    const studio_proto::SettingState &snapshot() const {
        return state;
    }
    void change(const studio_proto::SettingRequest &request);
};
