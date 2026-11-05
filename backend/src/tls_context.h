#pragma once
#include "service.pb.h"
#include "tls_config.h"

// Owns key material for exactly one IED instance. No plaintext downgrade on error.
class TlsContext {
    TLSConfiguration configuration = nullptr;

  public:
    ~TlsContext();
    TlsContext() = default;
    TlsContext(const TlsContext &) = delete;
    TlsContext &operator=(const TlsContext &) = delete;
    void configure(const service_studio::TlsOptions &options);
    TLSConfiguration get() const {
        return configuration;
    }
    void reset();
};
