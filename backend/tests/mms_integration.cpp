#include "iec61850_client.h"
#include <iostream>
#include <atomic>
#include <thread>
#include <chrono>
#include <cmath>
#include <stdexcept>
#include <string>
static void require(bool value, const char *message) {
    if (!value)
        throw std::runtime_error(message);
    std::cout << "PASS " << message << std::endl;
}
static void report(void *p, ClientReport r) {
    if (ClientReport_getDataSetValues(r))
        ++*static_cast<std::atomic<int> *>(p);
}
int main(int argc, char **argv) {
    IedConnection con = IedConnection_create();
    IedClientError error;
    try {
        require(argc >= 3, "arguments");
        IedConnection_setRequestTimeout(con, 3000);
        IedConnection_connect(con, &error, "127.0.0.1", std::stoi(argv[1]));
        require(error == IED_ERROR_OK, "real MMS connect");
        auto devices = IedConnection_getLogicalDeviceList(con, &error);
        require(error == IED_ERROR_OK && LinkedList_size(devices) > 0, "logical device discovery");
        LinkedList_destroy(devices);
        std::string mode = argv[2];
        if (mode == "import") {
            require(argc >= 4, "import reference provided");
            auto value = IedConnection_readObject(con, &error, argv[3], IEC61850_FC_MX);
            require(error == IED_ERROR_OK && value, "imported model real MMS read");
            MmsValue_delete(value);
        } else {
            float v =
                IedConnection_readFloatValue(con, &error, "STUDIOLD0/GGIO1.AnIn1.mag.f", IEC61850_FC_MX);
            require(error == IED_ERROR_OK && std::isfinite(v), "read FLOAT32 measurement");
            auto ds = IedConnection_readDataSetValues(con, &error, "STUDIOLD0/LLN0.Measurements", nullptr);
            require(error == IED_ERROR_OK && ds, "read predefined dataset");
            ClientDataSet_destroy(ds);
            if (mode == "full") {
                LinkedList members = LinkedList_create();
                LinkedList_add(members, const_cast<char *>("STUDIOLD0/GGIO1.AnIn1.mag.f[MX]"));
                IedConnection_createDataSet(con, &error, "STUDIOLD0/LLN0.ClientSet", members);
                require(error == IED_ERROR_OK, "create dynamic dataset");
                LinkedList_destroyStatic(members);
                IedConnection_deleteDataSet(con, &error, "STUDIOLD0/LLN0.ClientSet");
                require(error == IED_ERROR_OK, "delete dynamic dataset");
                const char *names[] = {"STUDIOLD0/LLN0.RP.Measurements01", "STUDIOLD0/LLN0.BR.Events01"};
                for (auto name : names) {
                    std::atomic<int> count{0};
                    auto rcb = IedConnection_getRCBValues(con, &error, name, nullptr);
                    require(error == IED_ERROR_OK && rcb, "read RCB");
                    IedConnection_installReportHandler(con, name, ClientReportControlBlock_getRptId(rcb),
                                                       report, &count);
                    ClientReportControlBlock_setRptEna(rcb, true);
                    IedConnection_setRCBValues(con, &error, rcb, RCB_ELEMENT_RPT_ENA, true);
                    require(error == IED_ERROR_OK, "enable RCB");
                    ClientReportControlBlock_setGI(rcb, true);
                    IedConnection_setRCBValues(con, &error, rcb, RCB_ELEMENT_GI, true);
                    require(error == IED_ERROR_OK, "request general interrogation");
                    for (int i = 0; i < 30 && count == 0; i++)
                        std::this_thread::sleep_for(std::chrono::milliseconds(100));
                    require(count > 0, "receive real MMS report payload");
                    ClientReportControlBlock_setRptEna(rcb, false);
                    IedConnection_setRCBValues(con, &error, rcb, RCB_ELEMENT_RPT_ENA, true);
                    IedConnection_uninstallReportHandler(con, name);
                    ClientReportControlBlock_destroy(rcb);
                }
            }
            const char *names[] = {"STUDIOLD0/GGIO1.SPCSO1", "STUDIOLD0/GGIO1.SPCSO2", "STUDIOLD0/XCBR1.Pos"};
            for (auto name : names) {
                auto ctl = ControlObjectClient_create(name, con);
                require(ctl != nullptr, "create control client");
                ControlObjectClient_setOrigin(ctl, "ServiceStudioIntegration", 3);
                auto value = MmsValue_newBoolean(true);
                auto cm = ControlObjectClient_getControlModel(ctl);
                bool selected = true;
                if (cm == CONTROL_MODEL_SBO_ENHANCED)
                    selected = ControlObjectClient_selectWithValue(ctl, value);
                if (cm == CONTROL_MODEL_SBO_NORMAL)
                    selected = ControlObjectClient_select(ctl);
                if (mode != "rejected")
                    require(selected, "select / direct ready");
                bool accepted = selected && ControlObjectClient_operate(ctl, value, 0);
                require(mode == "rejected" ? !accepted : accepted,
                        mode == "rejected" ? "control policy rejected remote operation"
                                           : "remote operate accepted");
                MmsValue_delete(value);
                ControlObjectClient_destroy(ctl);
            }
        }
        IedConnection_close(con);
        IedConnection_destroy(con);
        return 0;
    } catch (const std::exception &e) {
        std::cerr << "FAIL " << e.what() << " error=" << error << std::endl;
        IedConnection_close(con);
        IedConnection_destroy(con);
        return 1;
    }
}
