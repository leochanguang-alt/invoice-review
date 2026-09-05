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
