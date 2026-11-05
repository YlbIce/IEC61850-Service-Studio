#include "grpc_service.h"
#include <iostream>

int main(int argc, char **argv) {
    if (argc == 3 && std::string(argv[1]) == "--validate") {
        auto *m = ConfigFileParser_createModelFromConfigFileEx(argv[2]);
        if (!m || !m->firstChild) {
            if (m)
                IedModel_destroy(m);
            std::cerr << "Invalid CFG model";
            return 4;
        }
        std::cout << "VALID " << m->name << std::endl;
        IedModel_destroy(m);
        return 0;
    }
    const char *secret = std::getenv("SERVICE_STUDIO_TOKEN");
    if (!secret || std::string(secret).size() < 32) {
        std::cerr << "Management token missing\n";
        return 2;
    }
    ManagementService studio(secret);
    grpc::ServerBuilder builder;
    int port = 0;
    builder.AddListeningPort("127.0.0.1:0", grpc::InsecureServerCredentials(), &port);
    builder.SetMaxReceiveMessageSize(8 * 1024 * 1024);
    builder.RegisterService(&studio);
    auto server = builder.BuildAndStart();
    if (!server)
        return 3;
    std::cout << "READY " << port << std::endl;
    // Parent owns stdin; even an abnormal Electron exit closes it and shuts down MMS.
    std::thread parent([&] {
        std::string line;
        while (std::getline(std::cin, line)) {
            if (line == "shutdown")
                break;
        }
        server->Shutdown();
    });
    server->Wait();
    parent.join();
    return 0;
}
