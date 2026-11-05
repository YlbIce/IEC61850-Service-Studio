#pragma once
#include <grpcpp/grpcpp.h>
#include "service.grpc.pb.h"
#include "server_engine.h"

// Transport owns authentication, never model or protocol lifecycle.
class ManagementService final : public service_studio::ServiceStudio::Service {
    ServerEngine engine;
    const std::string token;
    grpc::Status authenticate(grpc::ServerContext *c) const {
        auto it = c->client_metadata().find("x-studio-token");
        if (it == c->client_metadata().end() || std::string(it->second.data(), it->second.length()) != token)
            return {grpc::StatusCode::UNAUTHENTICATED, "Invalid local management token"};
        return grpc::Status::OK;
    }

  public:
    explicit ManagementService(std::string secret) : token(std::move(secret)) {}
    grpc::Status Apply(grpc::ServerContext *context, const studio_proto::Project *request,
                       studio_proto::Reply *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Apply(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Start(grpc::ServerContext *context, const studio_proto::Empty *request,
                       studio_proto::Reply *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Start(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Stop(grpc::ServerContext *context, const studio_proto::Empty *request,
                      studio_proto::Reply *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Stop(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Update(grpc::ServerContext *context, const studio_proto::UpdateRequest *request,
                        studio_proto::Reply *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Update(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Simulation(grpc::ServerContext *context, const studio_proto::SimulationRequest *request,
                            studio_proto::Reply *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Simulation(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Snapshot(grpc::ServerContext *context, const studio_proto::Empty *request,
                          studio_proto::State *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Snapshot(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status GetModel(grpc::ServerContext *context, const studio_proto::Empty *request,
                          studio_proto::Model *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.GetModel(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Interfaces(grpc::ServerContext *context, const studio_proto::Empty *request,
                            studio_proto::InterfaceList *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Interfaces(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status Settings(grpc::ServerContext *context, const studio_proto::Empty *request,
                          studio_proto::SettingState *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.Settings(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
    grpc::Status ChangeSetting(grpc::ServerContext *context, const studio_proto::SettingRequest *request,
                               studio_proto::Reply *reply) override {
        auto status = authenticate(context);
        if (status.ok()) {
            try {
                engine.ChangeSetting(request, reply);
            } catch (const std::exception &e) {
                return {grpc::StatusCode::INTERNAL, e.what()};
            }
        }
        return status;
    }
};
