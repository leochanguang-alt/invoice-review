(function exposeInvoiceReview(root) {
    root.isReviewableStatus = function isReviewableStatus(status) {
        const normalized = String(status || "").toLowerCase().trim();
        if (!normalized) return false;
        return normalized.includes("waiting") || normalized === "confirmed";
    };

    root.formatDuplicateWarning = function formatDuplicateWarning(matches) {
        if (!Array.isArray(matches) || matches.length === 0) return "";
        return matches.map((match) => {
            const identity = match.invoice_id || `#${match.id}`;
            const status = match.status || "unknown status";
            return `${identity} (${status})`;
        }).join(", ");
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
