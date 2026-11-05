#pragma once
#include "engine_common.h"
#include "tls_context.h"
#include "setting_store.h"
#include "publisher_service.h"

class ServerEngine final {

    struct Point {
        ServerEngine *owner;
        studio_proto::Point spec;
        std::string ref;
        DataObject *object = nullptr;
        DataAttribute *value = nullptr, *quality = nullptr, *time = nullptr;
        double current = 0;
        uint32_t q = 0;
        uint64_t timestamp = 0;
        bool blocked = false;
    };
    std::mutex op;
    std::recursive_mutex data;
    TlsContext tls;
    std::unique_ptr<SettingStore> settings;
    PublisherService publishers;
    IedModel *model = nullptr;
    IedServer ied = nullptr;
    studio_proto::Project project;
    std::vector<std::unique_ptr<Point>> points;
    std::map<std::string, studio_proto::Session> sessions;
    std::map<ReportControlBlock *, studio_proto::LiveReport> reports;
    std::vector<studio_proto::Event> events;
    std::atomic<bool> alive{true};
    std::thread ticker;
    bool running = false, simulation = false;
    uint64_t started = 0, updates = 0, controls = 0, sequence = 0;
    studio_proto::Model importedModel;

    void eventLocked(const std::string &category, const std::string &msg, const std::string &level = "INFO");
    void event(const std::string &category, const std::string &msg, const std::string &level = "INFO");
    void setValue(Point &p, double value, uint32_t q);
    static CheckHandlerResult checkControl(ControlAction action, void *param, MmsValue *value, bool test,
                                           bool);
    static ControlHandlerResult control(ControlAction, void *param, MmsValue *v, bool test);
    static void selection(ControlAction, void *param, bool selected, SelectStateChangedReason);
    static void connection(IedServer, ClientConnection c, bool connected, void *param);
    static void report(void *param, ReportControlBlock *rcb, ClientConnection c, IedServer_RCBEventType e,
                       const char *name, MmsDataAccessError error);
    std::string validate(const studio_proto::Project &p);
    void stop();
    void clear();
    void scan(ModelNode *node);
    void describe(ModelNode *node, unsigned depth, studio_proto::Model *result);
    void build(const studio_proto::Project &p, IedModel *parsed);

  public:
    ServerEngine();
    ~ServerEngine();
    void Interfaces(const studio_proto::Empty *, studio_proto::InterfaceList *);
    void Settings(const studio_proto::Empty *, studio_proto::SettingState *);
    void ChangeSetting(const studio_proto::SettingRequest *, studio_proto::Reply *);
    void Apply(const studio_proto::Project *p, studio_proto::Reply *r);
    void Start(const studio_proto::Empty *, studio_proto::Reply *r);
    void Stop(const studio_proto::Empty *, studio_proto::Reply *r);
    void Update(const studio_proto::UpdateRequest *q, studio_proto::Reply *r);
    void Simulation(const studio_proto::SimulationRequest *q, studio_proto::Reply *r);
    void Snapshot(const studio_proto::Empty *, studio_proto::State *s);
    void GetModel(const studio_proto::Empty *, studio_proto::Model *result);
};
