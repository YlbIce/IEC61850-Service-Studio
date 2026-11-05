#include "setting_store.h"
#include <filesystem>
#include <fstream>
#include <windows.h>

namespace {
std::string reference(ModelNode *node) {
    char value[256]{};
    if (!ModelNode_getObjectReference(node, value))
        throw std::runtime_error("Setting reference is too long");
    return value;
}
void collect(ModelNode *node, FunctionalConstraint fc, std::vector<DataAttribute *> &output) {
    for (; node; node = node->sibling) {
        if (node->modelType == DataAttributeModelType && !node->firstChild) {
            auto *da = reinterpret_cast<DataAttribute *>(node);
            if (da->fc == fc)
                output.push_back(da);
        }
        collect(node->firstChild, fc, output);
    }
}
void encode(studio_proto::SettingValue *out, DataAttribute *da) {
    out->set_reference(reference(reinterpret_cast<ModelNode *>(da)));
    auto *value = da->mmsValue;
    if (!value)
        throw std::runtime_error("Setting has no MMS value");
    auto size = MmsValue_encodeMmsData(value, nullptr, 0, false);
    if (size < 1 || size > 65536)
        throw std::runtime_error("Setting value exceeds storage limit");
    std::string bytes(size, '\0');
    MmsValue_encodeMmsData(value, reinterpret_cast<uint8_t *>(bytes.data()), 0, true);
    out->set_encoded(bytes);
    char display[1024]{};
    MmsValue_printToBuffer(value, display, sizeof(display));
    out->set_value(display);
    out->set_type(std::to_string(da->type));
}
using Value = std::unique_ptr<MmsValue, decltype(&MmsValue_delete)>;
Value decode(const studio_proto::SettingValue &in) {
    auto bytes = in.encoded();
    int end = 0;
    Value value(MmsValue_decodeMmsDataMaxRecursion(reinterpret_cast<uint8_t *>(bytes.data()), 0,
                                                   static_cast<int>(bytes.size()), &end, 16),
                MmsValue_delete);
    if (!value || end != bytes.size())
        throw std::runtime_error("Corrupt setting value");
    return value;
}
} // namespace

void SettingStore::persist(const studio_proto::SettingState &next) {
    if (path.empty())
        throw std::runtime_error("Setting storage path is required");
    auto file = std::filesystem::u8path(path), tmp = file;
    tmp += L".tmp";
    std::filesystem::create_directories(file.parent_path());
    auto bytes = next.SerializeAsString();
    HANDLE handle =
        CreateFileW(tmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (handle == INVALID_HANDLE_VALUE)
        throw std::runtime_error("Cannot create setting transaction file");
    DWORD written = 0;
    bool ok = WriteFile(handle, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr) &&
              written == bytes.size() && FlushFileBuffers(handle);
    CloseHandle(handle);
    if (!ok || !MoveFileExW(tmp.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(tmp.c_str());
        throw std::runtime_error("Cannot commit setting transaction; previous bank preserved");
    }
}

SettingStore::SettingStore(IedServer s, IedModel *model, std::string file)
    : server(s), path(std::move(file)) {
    state.set_version(1);
    for (auto *block = model->sgcbs; block; block = block->sibling) {
        // Imported models can retain an SGCB placeholder with no banks.
        // It has no persistence or editing lifecycle, regardless of actSG.
        if (block->numOfSGs == 0)
            continue;
        if (!block->actSG || block->actSG > block->numOfSGs)
            throw std::runtime_error("Invalid SGCB active group or group count");
        Device device{block, {}, {}};
        auto *ld = block->parent->parent;
        collect(ld->firstChild, IEC61850_FC_SG, device.active);
        collect(ld->firstChild, IEC61850_FC_SE, device.edit);
        auto sort = [](auto *a, auto *b) {
            return reference(reinterpret_cast<ModelNode *>(a)) < reference(reinterpret_cast<ModelNode *>(b));
        };
        std::sort(device.active.begin(), device.active.end(), sort);
        std::sort(device.edit.begin(), device.edit.end(), sort);
        if (device.active.empty() || device.active.size() != device.edit.size())
            throw std::runtime_error("SG/SE leaf attributes must form complete pairs");
        auto *output = state.add_devices();
        output->set_reference(reference(reinterpret_cast<ModelNode *>(block->parent)) + ".SGCB");
        output->set_active(block->actSG);
        for (unsigned bank = 1; bank <= block->numOfSGs; ++bank) {
            auto *b = output->add_banks();
            b->set_number(bank);
            for (size_t i = 0; i < device.active.size(); ++i) {
                if (reference(reinterpret_cast<ModelNode *>(device.active[i])) !=
                        reference(reinterpret_cast<ModelNode *>(device.edit[i])) ||
                    device.active[i]->type != device.edit[i]->type)
                    throw std::runtime_error("SG/SE attribute type or reference mismatch");
                encode(b->add_values(), device.active[i]);
            }
        }
        devices.push_back(std::move(device));
    }
    if (devices.empty())
        return;
    if (std::filesystem::exists(std::filesystem::u8path(path))) {
        auto size = std::filesystem::file_size(std::filesystem::u8path(path));
        if (size > 16 * 1024 * 1024)
            throw std::runtime_error("Setting storage exceeds 16 MB");
        std::ifstream input(std::filesystem::u8path(path), std::ios::binary);
        studio_proto::SettingState saved;
        if (!saved.ParseFromIstream(&input) || saved.version() != 1 ||
            saved.devices_size() != state.devices_size())
            throw std::runtime_error("Setting storage is corrupt or belongs to a different model");
        for (int i = 0; i < saved.devices_size(); ++i) {
            const auto &d = saved.devices(i);
            const auto &expected = state.devices(i);
            if (d.reference() != expected.reference() || d.banks_size() != expected.banks_size() ||
                d.active() < 1 || d.active() > d.banks_size())
                throw std::runtime_error("Stored setting groups do not match model");
            for (int b = 0; b < d.banks_size(); ++b) {
                if (d.banks(b).number() != b + 1 ||
                    d.banks(b).values_size() != expected.banks(b).values_size())
                    throw std::runtime_error("Stored setting bank is incomplete");
                for (int j = 0; j < d.banks(b).values_size(); ++j) {
                    auto &value = d.banks(b).values(j);
                    auto &sample = expected.banks(b).values(j);
                    if (value.reference() != sample.reference() || value.type() != sample.type())
                        throw std::runtime_error("Stored setting schema mismatch");
                    auto decoded = decode(value);
                    if (!MmsValue_equalTypes(decoded.get(), devices[i].active[j]->mmsValue))
                        throw std::runtime_error("Stored setting MMS type mismatch");
                }
            }
        }
        state = saved;
    } else
        persist(state);
    for (size_t i = 0; i < devices.size(); ++i) {
        auto *block = devices[i].block;
        IedServer_changeActiveSettingGroup(server, block,
                                           static_cast<uint8_t>(state.devices(static_cast<int>(i)).active()));
        load(i, state.devices(static_cast<int>(i)).active(), false);
        IedServer_setActiveSettingGroupChangedHandler(server, block, activate, this);
        IedServer_setEditSettingGroupChangedHandler(server, block, edit, this);
        IedServer_setTransactionalSettingGroupConfirmationHandler(server, block, confirm, this);
    }
}
size_t SettingStore::index(SettingGroupControlBlock *block) const {
    for (size_t i = 0; i < devices.size(); ++i)
        if (devices[i].block == block)
            return i;
    throw std::runtime_error("Unknown setting group");
}
void SettingStore::load(size_t i, unsigned bank, bool editing) {
    auto &attrs = editing ? devices[i].edit : devices[i].active;
    const auto &values = state.devices(static_cast<int>(i)).banks(bank - 1).values();
    for (size_t j = 0; j < attrs.size(); ++j) {
        auto v = decode(values.Get(static_cast<int>(j)));
        IedServer_updateAttributeValue(server, attrs[j], v.get());
    }
}
bool SettingStore::activate(void *p, SettingGroupControlBlock *block, uint8_t bank, ClientConnection) {
    auto &self = *static_cast<SettingStore *>(p);
    try {
        auto i = self.index(block);
        auto next = self.state;
        next.mutable_devices(static_cast<int>(i))->set_active(bank);
        next.clear_error();
        self.persist(next);
        self.state = next;
        self.load(i, bank, false);
        return true;
    } catch (const std::exception &e) {
        self.state.set_error(e.what());
        return false;
    }
}
bool SettingStore::edit(void *p, SettingGroupControlBlock *block, uint8_t bank, ClientConnection) {
    auto &self = *static_cast<SettingStore *>(p);
    try {
        self.load(self.index(block), bank, true);
        return true;
    } catch (const std::exception &e) {
        self.state.set_error(e.what());
        return false;
    }
}
bool SettingStore::confirm(void *p, SettingGroupControlBlock *block, uint8_t bank) {
    auto &self = *static_cast<SettingStore *>(p);
    try {
        auto i = self.index(block);
        auto next = self.state;
        auto *b = next.mutable_devices(static_cast<int>(i))->mutable_banks(bank - 1);
        b->clear_values();
        for (auto *da : self.devices[i].edit)
            encode(b->add_values(), da);
        next.clear_error();
        self.persist(next);
        self.state = next;
        if (block->actSG == bank)
            self.load(i, bank, false);
        return true;
    } catch (const std::exception &e) {
        self.state.set_error(e.what());
        return false;
    }
}
void SettingStore::change(const studio_proto::SettingRequest &request) {
    int i = 0;
    for (; i < state.devices_size(); ++i)
        if (state.devices(i).reference() == request.reference())
            break;
    if (i == state.devices_size() || request.bank() < 1 || request.bank() > state.devices(i).banks_size())
        throw std::runtime_error("Unknown setting bank");
    auto *block = devices[i].block;
    if (block->editSG)
        throw std::runtime_error("An MMS client has reserved this setting device");
    if (request.activate()) {
        if (!activate(this, block, static_cast<uint8_t>(request.bank()), nullptr))
            throw std::runtime_error(state.error());
        IedServer_changeActiveSettingGroup(server, block, static_cast<uint8_t>(request.bank()));
        return;
    }
    auto next = state;
    auto *bank = next.mutable_devices(i)->mutable_banks(request.bank() - 1);
    bool found = false;
    for (auto &item : *bank->mutable_values())
        if (item.reference() == request.attribute()) {
            found = true;
            auto value = decode(item);
            const auto &text = request.value();
            size_t end = 0;
            switch (MmsValue_getType(value.get())) {
            case MMS_BOOLEAN:
                if (text != "true" && text != "false" && text != "0" && text != "1")
                    throw std::runtime_error("Expected boolean");
                MmsValue_setBoolean(value.get(), text == "true" || text == "1");
                break;
            case MMS_FLOAT: {
                double number = std::stod(text, &end);
                if (end != text.size() || !std::isfinite(number) || std::abs(number) > 1e30)
                    throw std::runtime_error("Invalid floating setting");
                MmsValue_setDouble(value.get(), number);
                break;
            }
            case MMS_INTEGER: {
                auto n = std::stoll(text, &end);
                if (end != text.size() || n < INT32_MIN || n > INT32_MAX)
                    throw std::runtime_error("Expected int32 setting");
                MmsValue_setInt32(value.get(), static_cast<int32_t>(n));
                break;
            }
            case MMS_UNSIGNED: {
                auto n = std::stoull(text, &end);
                if (end != text.size() || text[0] == '-' || n > UINT32_MAX)
                    throw std::runtime_error("Expected uint32 setting");
                MmsValue_setUint32(value.get(), static_cast<uint32_t>(n));
                break;
            }
            case MMS_VISIBLE_STRING:
                if (text.size() > 255)
                    throw std::runtime_error("String too long");
                MmsValue_setVisibleString(value.get(), text.c_str());
                break;
            default:
                throw std::runtime_error("Use an MMS client to edit this setting type");
            }
            auto bytes = std::string(MmsValue_encodeMmsData(value.get(), nullptr, 0, false), '\0');
            MmsValue_encodeMmsData(value.get(), reinterpret_cast<uint8_t *>(bytes.data()), 0, true);
            item.set_encoded(bytes);
            char display[1024]{};
            MmsValue_printToBuffer(value.get(), display, sizeof(display));
            item.set_value(display);
        }
    if (!found)
        throw std::runtime_error("Unknown setting attribute");
    next.clear_error();
    persist(next);
    state = next;
    if (block->actSG == request.bank())
        load(i, request.bank(), false);
}
