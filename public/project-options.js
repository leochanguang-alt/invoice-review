(function exposeProjectOptions(root) {
    function normalized(value) {
        return value == null ? "" : String(value).trim();
    }

    root.escapeProjectOptionHtml = function escapeProjectOptionHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
    };

    root.buildArchivedExportRows = function buildArchivedExportRows(invoices) {
        const rows = [];
        let skippedCount = 0;
        for (const invoice of invoices || []) {
            const status = normalized(invoice.Status || invoice.status).toLowerCase();
            const achievedFileId = normalized(invoice.achieved_file_id);
            const achievedFileLink = normalized(invoice.achieved_file_link);
            let archivePath = "";
            if (achievedFileId.startsWith("bui_invoice/")) {
                archivePath = `buiservice-assets/${achievedFileId}`;
            } else if (achievedFileId.includes("/")) {
                archivePath = achievedFileId;
            } else {
                const pathMatch = achievedFileLink.match(
                    /(bui_invoice\/projects\/[^?]+)/,
                );
                archivePath = pathMatch
                    ? `buiservice-assets/${pathMatch[1]}`
                    : "";
            }
            if (status !== "submitted" || !archivePath) {
                skippedCount += 1;
                continue;
            }
            rows.push({
                Date: invoice["Invoice Date"] || invoice.invoice_date || "",
                Vendor: invoice.Vender || invoice.Vendor || invoice.vendor || "",
                "Original Amount": `${invoice.Amount || ""} ${invoice.Currency || ""}`.trim(),
                Category: invoice.Category || invoice.category || "",
                Owner: invoice.Owner || invoice.owner || "",
                "R2 File Path": archivePath,
            });
        }
        return { rows, skippedCount };
    };

    root.buildProjectOptions = function buildProjectOptions(
        projects,
        selectedCompanyId,
        selectedValue,
    ) {
        const company = normalized(selectedCompanyId).toLowerCase();
        const current = normalized(selectedValue);
        const options = (projects || [])
            .filter(project => {
                const projectCompany = normalized(
                    project.Company_ID || project["Company ID"],
                ).toLowerCase();
                const archived = project.archived === true
                    || project.Status === "Achieved";
                return company && projectCompany === company && !archived;
            })
            .map(project => ({
                value: normalized(
                    project["Project Code"] || project.Project_ID,
                ),
                selected: false,
                inactiveCurrent: false,
            }))
            .filter(option => option.value);

        const currentOption = options.find(
            option => option.value.toLowerCase() === current.toLowerCase(),
        );
        if (currentOption && current) {
            currentOption.selected = true;
        } else if (current) {
            options.push({
                value: current,
                selected: true,
                inactiveCurrent: true,
            });
        }

        return options;
    };
})(globalThis);
