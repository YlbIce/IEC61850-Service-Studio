#include "server_engine.h"

void ServerEngine::build(const studio_proto::Project &p, IedModel *parsed) {
    clear();
    points.clear();
    reports.clear();
    project = p;
    importedModel.Clear();
    model = parsed ? parsed : IedModel_create(p.ied_name().c_str());
    if (!parsed) {
        std::map<std::string, LogicalDevice *> lds;
        std::map<std::string, LogicalNode *> lns;
        auto ln = [&](const std::string &ld, const std::string &name) {
            if (!lds.count(ld)) {
                lds[ld] = LogicalDevice_create(ld.c_str(), model);
                lns[ld + "/LLN0"] = LogicalNode_create("LLN0", lds[ld]);
            }
            auto k = ld + "/" + name;
            if (!lns.count(k))
                lns[k] = LogicalNode_create(name.c_str(), lds[ld]);
            return lns[k];
        };
        for (const auto &x : p.points()) {
            auto n = std::make_unique<Point>();
            n->owner = this;
            n->spec = x;
            n->ref = p.ied_name() + key(x);
            n->blocked = x.blocked();
            auto parent = reinterpret_cast<ModelNode *>(ln(x.ld(), x.ln()));
            if (x.cdc() == "MV")
                n->object = CDC_MV_create(x.name().c_str(), parent, CDC_OPTION_DESC_UNICODE, false);
            else if (x.cdc() == "SPS")
                n->object = CDC_SPS_create(x.name().c_str(), parent, CDC_OPTION_DESC_UNICODE);
            else if (x.cdc() == "INS")
                n->object = CDC_INS_create(x.name().c_str(), parent, CDC_OPTION_DESC_UNICODE);
            else if (x.cdc() == "SPC")
                n->object =
                    CDC_SPC_create(x.name().c_str(), parent, CDC_OPTION_DESC_UNICODE, x.control_model() | CDC_CTL_MODEL_HAS_CANCEL);
            else
                n->object =
                    CDC_DPC_create(x.name().c_str(), parent, CDC_OPTION_DESC_UNICODE, x.control_model() | CDC_CTL_MODEL_HAS_CANCEL);
            auto node = reinterpret_cast<ModelNode *>(n->object);
            n->value = reinterpret_cast<DataAttribute *>(
                ModelNode_getChild(node, x.cdc() == "MV" ? "mag.f" : "stVal"));
            n->quality = reinterpret_cast<DataAttribute *>(ModelNode_getChild(node, "q"));
            n->time = reinterpret_cast<DataAttribute *>(ModelNode_getChild(node, "t"));
            points.push_back(std::move(n));
        }
        for (auto &d : p.datasets()) {
            auto set = DataSet_create(d.name().c_str(), ln(d.ld(), d.ln()));
            for (auto &member : d.members()) {
                auto it = std::find_if(points.begin(), points.end(),
                                       [&](auto &n) { return key(n->spec) == member; });
                const auto &x = (*it)->spec;
                // FCD includes value, quality and timestamp, so quality changes produce reports too.
                std::string variable = x.ln() + (x.cdc() == "MV" ? "$MX$" : "$ST$") + x.name();
                DataSetEntry_create(set, variable.c_str(), -1, nullptr);
            }
        }
        for (auto &r : p.reports()) {
            auto *block = ReportControlBlock_create(
                r.name().c_str(), ln(r.ld(), r.ln()), r.name().c_str(), r.buffered(), r.dataset().c_str(),
                r.conf_rev(), static_cast<uint8_t>(r.triggers()),
                RPT_OPT_SEQ_NUM | RPT_OPT_TIME_STAMP | RPT_OPT_REASON_FOR_INCLUSION | RPT_OPT_DATA_SET |
                    RPT_OPT_CONF_REV,
                r.buffer_ms(), r.integrity_ms());
            reports[block].set_name(r.ld() + "/" + r.ln() + "." + r.name());
        }
    } else {
        scan(reinterpret_cast<ModelNode *>(model->firstChild));
        importedModel.set_ied_name(model->name);
        for (auto *d = model->dataSets; d; d = d->sibling) {
            auto *ds = importedModel.add_datasets();
            ds->set_ld(d->logicalDeviceName);
            ds->set_name(d->name);
            for (auto *e = d->fcdas; e; e = e->sibling)
                ds->add_members(std::string(e->logicalDeviceName) + "/" + e->variableName);
        }
        for (auto *r = model->rcbs; r; r = r->sibling) {
            char ref[256];
            ModelNode_getObjectReference(reinterpret_cast<ModelNode *>(r->parent), ref);
            reports[r].set_name(std::string(ref) + "." + r->name);
            auto *out = importedModel.add_reports();
            out->set_name(r->name);
            out->set_ln(r->parent->name);
            out->set_ld(r->parent->parent->name);
            out->set_dataset(r->dataSetName ? r->dataSetName : "");
            out->set_buffered(r->buffered);
            out->set_integrity_ms(r->intPeriod);
            out->set_buffer_ms(r->bufferTime);
            out->set_triggers(r->trgOps);
            out->set_conf_rev(r->confRef);
        }
        if (model->lcbs)
            importedModel.add_notices("Log model preserved; MMS journal storage is not configured.");
    }
    PublisherService::templates(model, &importedModel);
    tls.configure(p.tls());
    IedServerConfig cfg = IedServerConfig_create();
    IedServerConfig_setEdition(cfg, IEC_61850_EDITION_2);
    IedServerConfig_setMaxMmsConnections(cfg, p.max_clients());
    IedServerConfig_setReportBufferSize(cfg, 262144);
    IedServerConfig_enableDynamicDataSetService(cfg, true);
    IedServerConfig_setMaxAssociationSpecificDataSets(cfg, 16);
    IedServerConfig_setMaxDomainSpecificDataSets(cfg, 16);
    IedServerConfig_setMaxDataSetEntries(cfg, 256);
    IedServerConfig_enableLogService(cfg, false);
    IedServerConfig_enableFileService(cfg, p.file_service());
    if (p.file_service())
        IedServerConfig_setFileServiceBasePath(cfg, p.file_root().c_str());
    ied = IedServer_createWithConfig(model, tls.get(), cfg);
    IedServerConfig_destroy(cfg);
    if (!ied)
        throw std::runtime_error("IED initialization failed (check model and TLS key/certificate)");
    settings = std::make_unique<SettingStore>(ied, model, p.settings_path());
    publishers.configure(p.publishers(), model, ied);
    IedServer_setLocalIpAddress(ied, project.host().c_str());
    IedServer_setServerIdentity(ied, "Service Studio", "Desktop IED Server", "0.2.2");
    IedServer_setConnectionIndicationHandler(ied, connection, this);
    IedServer_setRCBEventHandler(ied, report, this);
    IedServer_setWriteAccessPolicy(ied, IEC61850_FC_CF, ACCESS_POLICY_DENY);
    IedServer_setWriteAccessPolicy(ied, IEC61850_FC_DC, ACCESS_POLICY_DENY);
    for (auto &n : points) {
        if (!parsed) {
            setValue(*n, n->spec.value(), n->spec.quality());
            auto* du = reinterpret_cast<DataAttribute*>(ModelNode_getChild(reinterpret_cast<ModelNode*>(n->object), "dU"));
            if (du) { auto* text = MmsValue_newMmsString(n->spec.description().c_str()); IedServer_updateAttributeValue(ied, du, text); MmsValue_delete(text); }
        }
        else {
            auto *v = IedServer_getAttributeValue(ied, n->value);
            if (v)
                n->current = n->spec.cdc() == "MV" ? MmsValue_toFloat(v)
                             : (n->spec.cdc() == "SPC" || n->spec.cdc() == "SPS")
                                 ? (MmsValue_getBoolean(v) ? 1 : 0)
                             : n->spec.cdc() == "DPC" ? MmsValue_getBitStringAsInteger(v)
                                                      : MmsValue_toInt32(v);
            auto *q = IedServer_getAttributeValue(ied, n->quality);
            if (q)
                n->q = Quality_fromMmsValue(q);
        }
        if (ModelNode_getChild(reinterpret_cast<ModelNode *>(n->object), "Oper") &&
            (n->spec.cdc() == "SPC" || n->spec.cdc() == "DPC")) {
            IedServer_setControlHandler(ied, n->object, control, n.get());
            IedServer_setPerformCheckHandler(ied, n->object, checkControl, n.get());
            IedServer_setSelectStateChangedHandler(ied, n->object, selection, n.get());
        }
    }
}
