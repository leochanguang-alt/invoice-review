export function requireSingleSubmittedUpdate({ data, error }) {
    if (error) {
        throw new Error(error.message);
    }

    const updatedCount = Array.isArray(data) ? data.length : 0;
    if (updatedCount !== 1) {
        throw new Error(
            `Conditional submit expected exactly one invoice, updated ${updatedCount}`,
        );
    }

    return data[0];
}

export function buildSubmitMessage(results) {
    const successCount = results.filter(result => result.success).length;
    const failures = results.filter(result => !result.success);
    const failureSummary = failures.length > 0
        ? `, ${failures.length} failed: ${failures[0].error}`
        : "";
    return `Submitted ${successCount} record(s)${failureSummary}`;
}
