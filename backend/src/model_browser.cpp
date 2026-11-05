#include "server_engine.h"

void ServerEngine::scan(ModelNode *node) {
    for (; node; node = node->sibling) {
        if (node->modelType == DataObjectModelType) {
            auto value = reinterpret_cast<DataAttribute *>(ModelNode_getChild(node, "mag.f"));
            bool mv = value && value->modelType == DataAttributeModelType && value->type == IEC61850_FLOAT32;
            if (!mv)
                value = reinterpret_cast<DataAttribute *>(ModelNode_getChild(node, "stVal"));
            auto q = reinterpret_cast<DataAttribute *>(ModelNode_getChild(node, "q"));
            auto t = reinterpret_cast<DataAttribute *>(ModelNode_getChild(node, "t"));
            if (value && value->modelType == DataAttributeModelType && q && t &&
                q->modelType == DataAttributeModelType && t->modelType == DataAttributeModelType &&
                (mv || value->type == IEC61850_BOOLEAN || value->type == IEC61850_CODEDENUM ||
                 value->type == IEC61850_INT32 || value->type == IEC61850_ENUMERATED)) {
                auto p = std::make_unique<Point>();
                p->owner = this;
                char ref[256]{};
                if (!ModelNode_getObjectReference(node, ref))
                    throw std::runtime_error("Point reference exceeds 129 characters");
                p->ref = ref;
                p->object = reinterpret_cast<DataObject *>(node);
                p->value = value;
                p->quality = q;
                p->time = t;
                bool ctl = ModelNode_getChild(node, "Oper") != nullptr;
                p->spec.set_cdc(mv                                  ? "MV"
                                : value->type == IEC61850_BOOLEAN   ? (ctl ? "SPC" : "SPS")
                                : value->type == IEC61850_CODEDENUM ? "DPC"
                                                                    : "INS");
                p->spec.set_waveform("constant");
                p->spec.set_period(10);
                points.push_back(std::move(p));
            }
        }
        scan(node->firstChild);
    }
}

void ServerEngine::describe(ModelNode *node, unsigned depth, studio_proto::Model *result) {
    for (; node; node = node->sibling) {
        char ref[256] = {};
        if (node->modelType == LogicalDeviceModelType) {
            auto *ld = reinterpret_cast<LogicalDevice *>(node);
            std::string reference = ld->ldName ? ld->ldName : std::string(model->name) + ld->name;
            std::snprintf(ref, sizeof(ref), "%s", reference.c_str());
        } else if (!ModelNode_getObjectReference(node, ref)) {
            std::snprintf(ref, sizeof(ref), "%s", "<reference exceeds 129 characters>");
        }
        auto *n = result->add_nodes();
        n->set_reference(ref);
        n->set_name(node->name ? node->name : "[]");
        n->set_depth(depth);
        static const char *kinds[] = {"LD", "LN", "DO", "DA"};
        n->set_kind(kinds[node->modelType]);
        if (node->modelType == DataAttributeModelType) {
            auto *da = reinterpret_cast<DataAttribute *>(node);
            const char *fc = FunctionalConstraint_toString(da->fc);
            n->set_fc(fc ? fc : "");
            n->set_type(std::to_string(da->type));
            MmsValue *value = IedServer_getAttributeValue(ied, da);
            if (value && !node->firstChild) {
                char buf[1024];
                MmsValue_printToBuffer(value, buf, sizeof(buf));
                n->set_value(buf);
            }
        }
        describe(node->firstChild, depth + 1, result);
    }
}

void ServerEngine::GetModel(const studio_proto::Empty *, studio_proto::Model *result) {
    std::lock_guard<std::mutex> l(op);
    if (!ied)
        return;
    *result = importedModel;
    result->set_ied_name(model->name);
    if (project.config_path().empty()) {
        for (auto &d : project.datasets())
            *result->add_datasets() = d;
        for (auto &r : project.reports())
            *result->add_reports() = r;
    }
    IedServer_lockDataModel(ied);
    describe(reinterpret_cast<ModelNode *>(model->firstChild), 0, result);
    IedServer_unlockDataModel(ied);
    return;
}
