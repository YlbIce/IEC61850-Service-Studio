#include "publisher_service.h"
#include "goose_publisher.h"
#include "sv_publisher.h"
#include "hal_ethernet.h"
#include <pcap.h>
#include <functional>
#include <iphlpapi.h>

namespace {
using Clock = std::chrono::steady_clock;
using Value = std::unique_ptr<MmsValue, decltype(&MmsValue_delete)>;
void requirePcap() {
    // Resolve only from trusted system driver locations. MMS itself does not require Npcap.
    static HMODULE module = [] {
        HMODULE result = LoadLibraryExW(L"wpcap.dll", nullptr, LOAD_LIBRARY_SEARCH_SYSTEM32);
        if (!result) {
            wchar_t directory[MAX_PATH]{};
            GetSystemDirectoryW(directory, MAX_PATH);
            std::wstring file = std::wstring(directory) + L"\\Npcap\\wpcap.dll";
            result = LoadLibraryExW(file.c_str(), nullptr,
                                    LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
        }
        return result;
    }();
    if (!module) throw std::runtime_error("Npcap is not installed; MMS remains available, Ethernet publishing requires Npcap");
}
std::string datasetReference(IedModel *model, DataSet *dataset) {
    auto *ld = IedModel_getDevice(model, dataset->logicalDeviceName);
    std::string device =
        ld && ld->ldName ? ld->ldName : std::string(model->name) + dataset->logicalDeviceName;
    return device + "/" + dataset->name;
}
CommParameters parameters(const studio_proto::Publisher &c) {
    CommParameters p{};
    unsigned mac[6]{};
    char tail;
    if (std::sscanf(c.destination().c_str(), "%x:%x:%x:%x:%x:%x%c", &mac[0], &mac[1], &mac[2], &mac[3],
                    &mac[4], &mac[5], &tail) != 6)
        throw std::runtime_error("Invalid multicast MAC address");
    for (int i = 0; i < 6; ++i) {
        if (mac[i] > 255)
            throw std::runtime_error("Invalid MAC octet");
        p.dstAddress[i] = static_cast<uint8_t>(mac[i]);
    }
    if (!(mac[0] & 1) || mac[0] == 255)
        throw std::runtime_error("Publisher destination must be multicast");
    if (c.app_id() > 65535 || c.vlan_id() > 4094 || c.priority() > 7 || !c.conf_rev())
        throw std::runtime_error("Invalid APPID/VLAN/priority/ConfRev");
    p.appId = static_cast<uint16_t>(c.app_id());
    p.vlanId = static_cast<uint16_t>(c.vlan_id());
    p.vlanPriority = static_cast<uint8_t>(c.priority());
    return p;
}
std::string adapterIndex(const std::string &name) {
    requirePcap();
    char error[PCAP_ERRBUF_SIZE]{};
    pcap_if_t *devices = nullptr;
    if (pcap_findalldevs(&devices, error) != 0)
        throw std::runtime_error(error);
    int index = 0, found = -1;
    for (auto *d = devices; d; d = d->next, ++index)
        if (name == d->name)
            found = index;
    pcap_freealldevs(devices);
    if (found < 0)
        throw std::runtime_error("Selected Ethernet adapter no longer exists");
    auto *handle = pcap_open_live(name.c_str(), 65536, 0, 1, error);
    if (!handle)
        throw std::runtime_error(std::string("Cannot open Npcap adapter: ") + error);
    bool ethernet = pcap_datalink(handle) == DLT_EN10MB;
    pcap_close(handle);
    if (!ethernet)
        throw std::runtime_error("GOOSE/SV require an Ethernet adapter (IP loopback is unsupported)");
    return std::to_string(found);
}
void attributeTypes(ModelNode *node, std::map<MmsValue *, int> &types) {
    for (; node; node = node->sibling) {
        if (node->modelType == DataAttributeModelType && !node->firstChild) {
            auto *attribute = reinterpret_cast<DataAttribute *>(node);
            if (attribute->mmsValue)
                types[attribute->mmsValue] = attribute->type;
        }
        attributeTypes(node->firstChild, types);
    }
}
void leaves(MmsValue *value, const std::function<void(MmsValue *)> &visit) {
    auto type = MmsValue_getType(value);
    if (type == MMS_STRUCTURE || type == MMS_ARRAY)
        for (int i = 0; i < MmsValue_getArraySize(value); ++i)
            leaves(MmsValue_getElement(value, i), visit);
    else
        visit(value);
}
} // namespace
struct PublisherService::Stream {
    studio_proto::Publisher config;
    studio_proto::PublisherStatus status;
    DataSet *dataset = nullptr;
    GoosePublisher goose = nullptr;
    SVPublisher sv = nullptr;
    SVPublisher_ASDU asdu = nullptr;
    LinkedList values = nullptr;
    std::vector<MmsValue *> sources;
    std::vector<Value> copies;
    std::vector<int> offsets, formats;
    Clock::time_point due;
    unsigned interval = 0;
    ~Stream() {
        if (goose)
            GoosePublisher_destroy(goose);
        if (sv)
            SVPublisher_destroy(sv);
        if (values)
            LinkedList_destroyStatic(values);
    }
};
PublisherService::PublisherService() = default;
PublisherService::~PublisherService() {
    stop();
}
void PublisherService::interfaces(studio_proto::InterfaceList *output) {
    requirePcap();
    char error[PCAP_ERRBUF_SIZE]{};
    pcap_if_t *list = nullptr;
    if (pcap_findalldevs(&list, error) != 0)
        throw std::runtime_error(error);
    ULONG size = 0;
    GetAdaptersAddresses(AF_UNSPEC, 0, nullptr, nullptr, &size);
    std::vector<uint8_t> buffer(size);
    auto *adapters = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(buffer.data());
    const bool found = GetAdaptersAddresses(AF_UNSPEC, 0, nullptr, adapters, &size) == NO_ERROR;
    for (auto *d = list; d; d = d->next) {
        auto *item = output->add_interfaces();
        item->set_id(d->name);
        item->set_description(d->description ? d->description : d->name);
        if (found)
            for (auto *a = adapters; a; a = a->Next)
                if (std::string(d->name).find(a->AdapterName) != std::string::npos) {
                    char text[1024]{};
                    WideCharToMultiByte(CP_UTF8, 0, a->FriendlyName, -1, text, sizeof(text), nullptr,
                                        nullptr);
                    item->set_description(std::string(text) + " — " + item->description());
                    break;
                }
    }
    pcap_freealldevs(list);
}
void PublisherService::configure(const google::protobuf::RepeatedPtrField<studio_proto::Publisher> &configs,
                                 IedModel *m, IedServer s) {
    stop();
    std::lock_guard<std::mutex> lock(mutex);
    configuration.assign(configs.begin(), configs.end());
    finalStatuses.clear();
    model = m;
    server = s;
    if (configuration.size() > 16)
        throw std::runtime_error("At most 16 publishers are supported");
    std::set<std::string> names;
    for (const auto &c : configuration) {
        if (c.name().size() > 64 || c.dataset().size() > 129 || c.control_ref().size() > 129 ||
            c.sv_id().size() > 64)
            throw std::runtime_error("Publisher identifier exceeds IEC frame limits");
        if (c.name().empty() || !names.insert(c.name()).second || (c.kind() != "GOOSE" && c.kind() != "SV"))
            throw std::runtime_error("Invalid or duplicate publisher name/type");
        parameters(c);
        if (c.kind() == "GOOSE" &&
            (c.min_ms() < 1 || c.max_ms() < c.min_ms() || c.max_ms() > 60000 || c.control_ref().empty()))
            throw std::runtime_error(
                "GOOSE requires a control reference and valid min/max retransmission times");
        if (c.kind() == "SV" && (c.sample_rate() < 1 || c.sample_rate() > 4800 || c.sv_id().empty()))
            throw std::runtime_error("SV requires an svID and sample rate 1..4800/s");
        bool found = false;
        for (auto *d = model->dataSets; d; d = d->sibling)
            if (datasetReference(model, d) == c.dataset())
                found = true;
        if (!found)
            throw std::runtime_error("Publisher dataset not found: " + c.dataset());
    }
}
void PublisherService::start() {
    stop();
    try {
        std::lock_guard<std::mutex> lock(mutex);
        finalStatuses.clear();
        for (const auto &c : configuration)
            if (c.enabled()) {
                auto stream = std::make_unique<Stream>();
                stream->config = c;
                stream->status.set_name(c.name());
                stream->status.set_kind(c.kind());
                for (auto *d = model->dataSets; d; d = d->sibling)
                    if (datasetReference(model, d) == c.dataset())
                        stream->dataset = d;
                if (!stream->dataset)
                    throw std::runtime_error("Publisher dataset disappeared");
                auto params = parameters(c);
                auto adapter = adapterIndex(c.interface_id());
                stream->values = LinkedList_create();
                int encodedSize = 0;
                for (auto *e = stream->dataset->fcdas; e; e = e->sibling) {
                    if (!e->value)
                        throw std::runtime_error("Unresolved dataset member");
                    encodedSize += MmsValue_encodeMmsData(e->value, nullptr, 0, false);
                    stream->sources.push_back(e->value);
                    stream->copies.emplace_back(MmsValue_clone(e->value), MmsValue_delete);
                    LinkedList_add(stream->values, stream->copies.back().get());
                }
                if (encodedSize > 1000 || stream->sources.empty())
                    throw std::runtime_error("Ethernet dataset exceeds one frame (1000-byte data limit)");
                if (c.kind() == "GOOSE") {
                    stream->goose = GoosePublisher_createEx(&params, adapter.c_str(), c.vlan());
                    if (!stream->goose)
                        throw std::runtime_error("Cannot create GOOSE publisher");
                    GoosePublisher_setGoCbRef(stream->goose, const_cast<char *>(c.control_ref().c_str()));
                    GoosePublisher_setGoID(stream->goose, const_cast<char *>(c.name().c_str()));
                    GoosePublisher_setDataSetRef(stream->goose, const_cast<char *>(c.dataset().c_str()));
                    GoosePublisher_setConfRev(stream->goose, c.conf_rev());
                    stream->interval = c.min_ms();
                } else {
                    stream->sv = SVPublisher_createEx(&params, adapter.c_str(), c.vlan());
                    if (!stream->sv)
                        throw std::runtime_error("Cannot create SV publisher");
                    stream->asdu =
                        SVPublisher_addASDU(stream->sv, c.sv_id().c_str(), c.dataset().c_str(), c.conf_rev());
                    std::map<MmsValue *, int> types;
                    attributeTypes(reinterpret_cast<ModelNode *>(model->firstChild), types);
                    for (auto *source : stream->sources)
                        leaves(source, [&](MmsValue *value) {
                            auto found = types.find(value);
                            if (found == types.end())
                                throw std::runtime_error(
                                    "SV leaf has no model type; cannot infer wire layout");
                            const int type = found->second;
                            int offset;
                            switch (type) {
                            case IEC61850_BOOLEAN:
                                offset = SVPublisher_ASDU_addINT8(stream->asdu);
                                break;
                            case IEC61850_FLOAT32:
                                offset = SVPublisher_ASDU_addFLOAT(stream->asdu);
                                break;
                            case IEC61850_FLOAT64:
                                offset = SVPublisher_ASDU_addFLOAT64(stream->asdu);
                                break;
                            case IEC61850_INT64:
                                offset = SVPublisher_ASDU_addINT64(stream->asdu);
                                break;
                            case IEC61850_TIMESTAMP:
                                offset = SVPublisher_ASDU_addTimestamp(stream->asdu);
                                break;
                            case IEC61850_INT8:
                            case IEC61850_INT16:
                            case IEC61850_INT32:
                            case IEC61850_INT8U:
                            case IEC61850_INT16U:
                            case IEC61850_INT24U:
                            case IEC61850_INT32U:
                            case IEC61850_ENUMERATED:
                            case IEC61850_CODEDENUM:
                            case IEC61850_QUALITY:
                                offset = SVPublisher_ASDU_addINT32(stream->asdu);
                                break;
                            default:
                                throw std::runtime_error("SV dataset contains an unsupported leaf type");
                            }
                            stream->formats.push_back(type);
                            stream->offsets.push_back(offset);
                        });
                    SVPublisher_ASDU_setSmpMod(stream->asdu, IEC61850_SV_SMPMOD_SAMPLES_PER_SECOND);
                    SVPublisher_ASDU_setSmpRate(stream->asdu, static_cast<uint16_t>(c.sample_rate()));
                    SVPublisher_ASDU_setSmpCntWrap(stream->asdu, static_cast<uint16_t>(c.sample_rate()));
                    SVPublisher_setupComplete(stream->sv);
                    SVPublisher_ASDU_setSmpSynch(stream->asdu, 0);
                }
                stream->due = Clock::now();
                stream->status.set_running(true);
                streams.push_back(std::move(stream));
            }
        active = !streams.empty();
        if (active) {
            timerHandle = CreateWaitableTimerExW(nullptr, nullptr, 0x00000002, TIMER_ALL_ACCESS);
            if (!timerHandle)
                timerHandle = CreateWaitableTimerW(nullptr, FALSE, nullptr);
            stopHandle = CreateEventW(nullptr, TRUE, FALSE, nullptr);
            if (!timerHandle || !stopHandle)
                throw std::runtime_error("Cannot create publisher scheduling timer");
            worker = std::thread(&PublisherService::run, this);
        }
    } catch (...) {
        stop();
        throw;
    }
}
void PublisherService::run() {
    while (active) {
        auto next = Clock::now() + std::chrono::milliseconds(1);
        for (auto &stream : streams) {
            auto &s = *stream;
            bool changed = false;
            if (!s.status.running())
                continue;
            if (!s.goose && Clock::now() < s.due) {
                next = std::min(next, s.due);
                continue;
            }
            // Copy only the selected datasets. Never hold UI/state locks while locking the IEC model.
            IedServer_lockDataModel(server);
            for (size_t i = 0; i < s.sources.size(); ++i) {
                if (!MmsValue_equals(s.sources[i], s.copies[i].get())) {
                    changed = true;
                    MmsValue_update(s.copies[i].get(), s.sources[i]);
                }
            }
            IedServer_unlockDataModel(server);
            const auto current = Clock::now();
            std::lock_guard<std::mutex> lock(mutex);
            if (changed && s.goose) {
                GoosePublisher_increaseStNum(s.goose);
                s.interval = s.config.min_ms();
                s.due = current;
                s.status.set_changes(s.status.changes() + 1);
            }
            if (current >= s.due && s.status.running()) {
                if (s.goose) {
                    GoosePublisher_setTimeAllowedToLive(s.goose, s.interval * 3);
                    if (GoosePublisher_publish(s.goose, s.values) < 0) {
                        s.status.set_error("GOOSE frame encoding failed");
                        s.status.set_running(false);
                    }
                    s.due = current + std::chrono::milliseconds(s.interval);
                    s.interval = std::min(s.interval * 2, s.config.max_ms());
                } else {
                    size_t index = 0;
                    for (auto &copy : s.copies)
                        leaves(copy.get(), [&](MmsValue *v) {
                            const int offset = s.offsets[index];
                            const int type = s.formats[index++];
                            switch (type) {
                            case IEC61850_BOOLEAN:
                                SVPublisher_ASDU_setINT8(s.asdu, offset, MmsValue_getBoolean(v));
                                break;
                            case IEC61850_FLOAT32:
                                SVPublisher_ASDU_setFLOAT(s.asdu, offset, MmsValue_toFloat(v));
                                break;
                            case IEC61850_FLOAT64:
                                SVPublisher_ASDU_setFLOAT64(s.asdu, offset, MmsValue_toDouble(v));
                                break;
                            case IEC61850_INT64:
                                SVPublisher_ASDU_setINT64(s.asdu, offset, MmsValue_toInt64(v));
                                break;
                            case IEC61850_QUALITY:
                                SVPublisher_ASDU_setQuality(
                                    s.asdu, offset, static_cast<Quality>(MmsValue_getBitStringAsInteger(v)));
                                break;
                            case IEC61850_CODEDENUM:
                                SVPublisher_ASDU_setINT32(
                                    s.asdu, offset, static_cast<int32_t>(MmsValue_getBitStringAsInteger(v)));
                                break;
                            case IEC61850_INT8U:
                            case IEC61850_INT16U:
                            case IEC61850_INT24U:
                            case IEC61850_INT32U:
                                SVPublisher_ASDU_setINT32(s.asdu, offset,
                                                          static_cast<int32_t>(MmsValue_toUint32(v)));
                                break;
                            case IEC61850_TIMESTAMP: {
                                Timestamp timestamp;
                                std::memcpy(timestamp.val, MmsValue_getUtcTimeBuffer(v), 8);
                                SVPublisher_ASDU_setTimestamp(s.asdu, offset, timestamp);
                                break;
                            }
                            default:
                                SVPublisher_ASDU_setINT32(s.asdu, offset, MmsValue_toInt32(v));
                                break;
                            }
                        });
                    SVPublisher_publish(s.sv);
                    SVPublisher_ASDU_increaseSmpCnt(s.asdu);
                    auto period = std::chrono::nanoseconds(1000000000 / s.config.sample_rate());
                    s.due += period;
                    if (s.due <= current) {
                        auto missed = (current - s.due) / period + 1;
                        s.status.set_late(s.status.late() + missed);
                        s.due += period * missed;
                    }
                }
                if (Ethernet_getLastSendResult() != 0) {
                    s.status.set_error(
                        "Ethernet driver rejected the frame; check adapter link and Npcap permissions");
                    s.status.set_running(false);
                } else if (s.status.running())
                    s.status.set_frames(s.status.frames() + 1);
            }
            next = std::min(next, s.due);
        }
        LARGE_INTEGER due;
        due.QuadPart = -std::max<int64_t>(
            1, std::chrono::duration_cast<std::chrono::nanoseconds>(next - Clock::now()).count() / 100);
        const bool scheduled = SetWaitableTimer(timerHandle, &due, 0, nullptr, nullptr, FALSE);
        HANDLE handles[] = {stopHandle, timerHandle};
        if (!scheduled || WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_FAILED) {
            std::lock_guard<std::mutex> lock(mutex);
            for (auto &stream : streams) {
                stream->status.set_running(false);
                stream->status.set_error("Publisher timer failed");
            }
            active = false;
        }
    }
}
void PublisherService::stop() {
    active = false;
    if (stopHandle)
        SetEvent(stopHandle);
    if (worker.joinable())
        worker.join();
    if (stopHandle)
        CloseHandle(stopHandle);
    if (timerHandle)
        CloseHandle(timerHandle);
    stopHandle = timerHandle = nullptr;
    std::lock_guard<std::mutex> lock(mutex);
    if (!streams.empty()) {
        finalStatuses.clear();
        for (const auto &stream : streams) {
            finalStatuses.push_back(stream->status);
            finalStatuses.back().set_running(false);
        }
    }
    streams.clear();
}
void PublisherService::snapshot(studio_proto::State *output) {
    std::lock_guard<std::mutex> lock(mutex);
    for (const auto &c : configuration) {
        auto *item = output->add_publishers();
        item->set_name(c.name());
        item->set_kind(c.kind());
        for (const auto &saved : finalStatuses)
            if (saved.name() == c.name())
                *item = saved;
        for (const auto &s : streams)
            if (s->config.name() == c.name())
                *item = s->status;
    }
}
