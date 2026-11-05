#include "publisher_service.h"
#include "sv_publisher.h"

namespace {
void common(studio_proto::Publisher *p, LogicalNode *parent, const char *name, const char *dataset,
            PhyComAddress *address, uint32_t revision, const char *kind, const char *fc) {
    char reference[256]{};
    if (!ModelNode_getObjectReference(reinterpret_cast<ModelNode *>(parent), reference))
        throw std::runtime_error("Publisher reference exceeds supported length");
    p->set_name(name);
    p->set_kind(kind);
    p->set_enabled(false);
    p->set_control_ref(std::string(reference) + "$" + fc + "$" + name);
    p->set_dataset(std::string(reference) + "$" + (dataset ? dataset : ""));
    p->set_conf_rev(revision ? revision : 1);
    p->set_vlan(true);
    p->set_min_ms(4);
    p->set_max_ms(1000);
    p->set_sample_rate(80);
    p->set_sv_id(name);
    if (address) {
        char mac[32]{};
        std::snprintf(mac, sizeof(mac), "%02x:%02x:%02x:%02x:%02x:%02x", address->dstAddress[0],
                      address->dstAddress[1], address->dstAddress[2], address->dstAddress[3],
                      address->dstAddress[4], address->dstAddress[5]);
        p->set_destination(mac);
        p->set_app_id(address->appId);
        p->set_vlan_id(address->vlanId);
        p->set_priority(address->vlanPriority);
    } else {
        p->set_destination(p->kind() == "GOOSE" ? "01:0c:cd:01:00:01" : "01:0c:cd:04:00:01");
        p->set_app_id(p->kind() == "GOOSE" ? 1000 : 0x4000);
        p->set_priority(4);
    }
}
} // namespace

void PublisherService::templates(IedModel *model, studio_proto::Model *result) {
    for (auto *cb = model->gseCBs; cb; cb = cb->sibling) {
        auto *p = result->add_publisher_templates();
        common(p, cb->parent, cb->name, cb->dataSetName, cb->address, cb->confRev, "GOOSE", "GO");
        if (cb->minTime > 0)
            p->set_min_ms(cb->minTime);
        if (cb->maxTime >= static_cast<int>(p->min_ms()))
            p->set_max_ms(cb->maxTime);
    }
    for (auto *cb = model->svCBs; cb; cb = cb->sibling) {
        auto *p = result->add_publisher_templates();
        common(p, cb->parent, cb->name, cb->dataSetName, cb->dstAddress, cb->confRev, "SV", "MS");
        if (cb->svId)
            p->set_sv_id(cb->svId);
        unsigned rate = cb->smpRate;
        if (cb->smpMod == IEC61850_SV_SMPMOD_PER_NOMINAL_PERIOD) {
            rate *= 50;
            result->add_notices("Imported SV sample-per-period templates assume 50 Hz; confirm the sample "
                                "rate before enabling.");
        } else if (cb->smpMod == IEC61850_SV_SMPMOD_SECONDS_PER_SAMPLE)
            rate = cb->smpRate == 1 ? 1 : 0;
        p->set_sample_rate(rate);
        if (cb->noASDU > 1)
            result->add_notices(
                "SV publisher sends one ASDU per frame; imported multi-ASDU packing must be reviewed.");
    }
}
