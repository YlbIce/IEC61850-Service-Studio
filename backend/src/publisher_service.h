#pragma once
#include "engine_common.h"

class PublisherService {
    struct Stream;
    IedModel *model = nullptr;
    IedServer server = nullptr;
    std::vector<studio_proto::Publisher> configuration;
    std::vector<std::unique_ptr<Stream>> streams;
    std::vector<studio_proto::PublisherStatus> finalStatuses;
    std::mutex mutex;
    void *timerHandle = nullptr;
    void *stopHandle = nullptr;
    std::thread worker;
    std::atomic<bool> active{false};
    void run();

  public:
    PublisherService();
    ~PublisherService();
    void configure(const google::protobuf::RepeatedPtrField<studio_proto::Publisher> &, IedModel *,
                   IedServer);
    void start();
    void stop();
    void snapshot(studio_proto::State *);
    static void interfaces(studio_proto::InterfaceList *);
    static void templates(IedModel *, studio_proto::Model *);
};
