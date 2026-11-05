#include "iec61850_client.h"
#include "tls_config.h"
#include <iostream>
#include <stdexcept>
#include <string>
#include <cmath>

void require(bool condition, const char *message) {
    if (!condition)
        throw std::runtime_error(message);
    std::cout << "PASS " << message << std::endl;
}
int main(int argc, char **argv) {
    IedConnection connection = nullptr;
    TLSConfiguration tls = nullptr;
    try {
        if (argc < 3)
            return 2;
        std::string mode = argv[2];
        IedClientError error;
        if (mode == "tls" || mode == "reject") {
            require(argc == 6, "TLS credential arguments");
            tls = TLSConfiguration_create();
            TLSConfiguration_setClientMode(tls);
            TLSConfiguration_setChainValidation(tls, true);
            TLSConfiguration_setTimeValidation(tls, true);
            TLSConfiguration_setMinTlsVersion(tls, TLS_VERSION_TLS_1_2);
            TLSConfiguration_setExpectedPeerName(tls, "localhost");
            require(TLSConfiguration_addCACertificateFromFile(tls, argv[3]), "load client trust CA");
            require(TLSConfiguration_setOwnCertificateFromFile(tls, argv[4]), "load client certificate");
            require(TLSConfiguration_setOwnKeyFromFile(tls, argv[5], nullptr), "load client private key");
            connection = IedConnection_createWithTlsSupport(tls);
        } else
            connection = IedConnection_create();
        IedConnection_setRequestTimeout(connection, 2500);
        IedConnection_connect(connection, &error, "127.0.0.1", std::stoi(argv[1]));
        if (mode == "reject" || mode == "reject-plain")
            require(error != IED_ERROR_OK, "untrusted or plaintext connection rejected");
        else {
            require(error == IED_ERROR_OK, "protocol connection accepted");
            if (mode == "tls") {
                auto value = IedConnection_readFloatValue(connection, &error, "STUDIOLD0/GGIO1.AnIn1.mag.f",
                                                          IEC61850_FC_MX);
                require(error == IED_ERROR_OK && std::isfinite(value), "real MMS read over mutual TLS");
            } else {
                const char *cb = "DEMOPROT/LLN0.SGCB";
                const char *attr = "DEMOPROT/PTOC1.StrVal.setMag.f";
                auto writeGroup = [&](const char *name, unsigned bank) {
                    IedConnection_writeUnsigned32Value(connection, &error, (std::string(cb) + name).c_str(),
                                                       IEC61850_FC_SP, bank);
                    require(error == IED_ERROR_OK, name);
                };
                if (mode == "setting-fail") {
                    writeGroup(".EditSG", 2);
                    IedConnection_writeFloatValue(connection, &error, attr, IEC61850_FC_SE, 99.0f);
                    require(error == IED_ERROR_OK, "prepare failed disk transaction");
                    IedConnection_writeBooleanValue(
                        connection, &error, (std::string(cb) + ".CnfEdit").c_str(), IEC61850_FC_SP, true);
                    require(error != IED_ERROR_OK, "disk commit failure returns MMS error");
                    auto reserved = IedConnection_readUnsigned32Value(
                        connection, &error, (std::string(cb) + ".EditSG").c_str(), IEC61850_FC_SP);
                    require(error == IED_ERROR_OK && reserved == 2,
                            "failed confirmation retains edit reservation");
                }
                if (mode == "setting-write") {
                    writeGroup(".EditSG", 2);
                    auto other = IedConnection_create();
                    IedClientError otherError;
                    IedConnection_connect(other, &otherError, "127.0.0.1", std::stoi(argv[1]));
                    IedConnection_writeUnsigned32Value(
                        other, &otherError, (std::string(cb) + ".EditSG").c_str(), IEC61850_FC_SP, 3);
                    require(otherError != IED_ERROR_OK, "second client setting reservation rejected");
                    IedConnection_destroy(other);
                    IedConnection_writeFloatValue(connection, &error, attr, IEC61850_FC_SE, 42.75f);
                    require(error == IED_ERROR_OK, "write SE value");
                    IedConnection_writeBooleanValue(
                        connection, &error, (std::string(cb) + ".CnfEdit").c_str(), IEC61850_FC_SP, true);
                    require(error == IED_ERROR_OK, "durable MMS CnfEdit acknowledged");
                    writeGroup(".ActSG", 2);
                }
                auto active = IedConnection_readUnsigned32Value(
                    connection, &error, (std::string(cb) + ".ActSG").c_str(), IEC61850_FC_SP);
                require(error == IED_ERROR_OK && active == 2, "active bank restored");
                auto value = IedConnection_readFloatValue(connection, &error, attr, IEC61850_FC_SG);
                require(error == IED_ERROR_OK && std::abs(value - 42.75f) < 0.001f,
                        "persisted SG value readable via MMS");
            }
        }
        IedConnection_destroy(connection);
        if (tls)
            TLSConfiguration_destroy(tls);
        return 0;
    } catch (const std::exception &e) {
        std::cerr << e.what() << std::endl;
        if (connection)
            IedConnection_destroy(connection);
        if (tls)
            TLSConfiguration_destroy(tls);
        return 1;
    }
}
