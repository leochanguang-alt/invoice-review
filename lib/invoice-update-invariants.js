const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizedProject(value) {
    return value == null ? "" : String(value).trim();
}

export function mapInvoiceSequenceFields(data) {
    const mapped = {};

    if (hasOwn(data, "charge_to_project")) {
        mapped.charge_to_project = data.charge_to_project;
    } else if (hasOwn(data, "Charge to Project")) {
        mapped.charge_to_project = data["Charge to Project"];
    }

    return mapped;
}

export function applyInvoiceSequenceInvariant(updateData, currentInvoice = {}) {
    const clearsGeneratedInvoiceId = hasOwn(updateData, "generated_invoice_id")
        && normalizedProject(updateData.generated_invoice_id) === "";
    const changesProject = hasOwn(updateData, "charge_to_project")
        && normalizedProject(updateData.charge_to_project)
            !== normalizedProject(currentInvoice.charge_to_project);

    if (!clearsGeneratedInvoiceId && !changesProject) {
        return { ...updateData };
    }

    const nextUpdate = {
        ...updateData,
        project_sequence: null,
        generated_invoice_id: null,
        achieved_file_id: null,
        achieved_file_link: null,
        status: "Waiting for Confirm",
    };
    return nextUpdate;
}
