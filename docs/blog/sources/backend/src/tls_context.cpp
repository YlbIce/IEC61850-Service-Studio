#include "tls_context.h"
#include <filesystem>
#include <fstream>
#include <vector>
#include <stdexcept>

static std::vector<uint8_t> readCredential(const std::string &path) {
    std::ifstream file(std::filesystem::u8path(path), std::ios::binary);
    if (!file)
        throw std::runtime_error("Cannot open TLS credential: " + path);
    file.seekg(0, std::ios::end);
    auto size = file.tellg();
    if (size <= 0 || size > 1024 * 1024)
        throw std::runtime_error("Invalid TLS credential size");
    file.seekg(0);
    std::vector<uint8_t> bytes(static_cast<size_t>(size) + 1, 0);
    if (!file.read(reinterpret_cast<char *>(bytes.data()), size))
        throw std::runtime_error("Cannot read TLS credential");
    return bytes; // PEM parsers require the terminating zero; UTF-8 Windows paths work via filesystem.
}

TlsContext::~TlsContext() {
    reset();
}
void TlsContext::reset() {
    if (configuration)
        TLSConfiguration_destroy(configuration);
    configuration = nullptr;
}
void TlsContext::configure(const service_studio::TlsOptions &o) {
    reset();
    if (!o.enabled())
        return;
    configuration = TLSConfiguration_create();
    if (!configuration)
        throw std::runtime_error("Cannot create TLS configuration");
    try {
        TLSConfiguration_setChainValidation(configuration, true);
        TLSConfiguration_setTimeValidation(configuration, true);
        TLSConfiguration_setMinTlsVersion(configuration,
                                          o.tls13_only() ? TLS_VERSION_TLS_1_3 : TLS_VERSION_TLS_1_2);
        TLSConfiguration_setMaxTlsVersion(configuration, TLS_VERSION_TLS_1_3);
        TLSConfiguration_enableSessionResumption(configuration, false);
        auto cert = readCredential(o.certificate()), key = readCredential(o.private_key()),
             ca = readCredential(o.ca());
        bool keyOk =
            TLSConfiguration_setOwnKey(configuration, key.data(), static_cast<int>(key.size()), nullptr);
        volatile uint8_t *secret = key.data();
        for (size_t i = 0; i < key.size(); ++i)
            secret[i] = 0;
        if (!keyOk ||
            !TLSConfiguration_setOwnCertificate(configuration, cert.data(), static_cast<int>(cert.size())) ||
            !TLSConfiguration_addCACertificate(configuration, ca.data(), static_cast<int>(ca.size())))
            throw std::runtime_error("Invalid TLS certificate, private key or CA (PEM required)");
        if (!TLSConfiguration_checkOwnCertificateKey(configuration))
            throw std::runtime_error("TLS certificate does not match private key");
        if (!o.crl().empty()) {
            auto bytes = readCredential(o.crl());
            if (!TLSConfiguration_addCRL(configuration, bytes.data(), static_cast<int>(bytes.size())))
                throw std::runtime_error("Invalid TLS CRL");
        }
        TLSConfiguration_setAllowOnlyKnownCertificates(configuration, !o.peer_certificate().empty());
        if (!o.peer_certificate().empty()) {
            auto bytes = readCredential(o.peer_certificate());
            if (!TLSConfiguration_addAllowedCertificate(configuration, bytes.data(),
                                                        static_cast<int>(bytes.size())))
                throw std::runtime_error("Invalid pinned peer certificate");
        }
    } catch (...) {
        reset();
        throw;
    }
}
