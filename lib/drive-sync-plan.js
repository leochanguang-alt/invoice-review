// Decides what to do with one Google Drive file when syncing it to R2.
//
// Drive lets several files share a name, and a file can be replaced in place
// (Gmail "save to Drive" over an existing name). Keying R2 purely on the file
// name meant both cases were silently skipped, so replaced or same-named
// invoices never reached the parser.

export function sanitizeDriveName(name) {
    if (!name) return "";
    return String(name).replace(/[\\/:*?"<>|]/g, "_").trim();
}

function splitExtension(name) {
    const dot = name.lastIndexOf(".");
    if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: "" };
    return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

// Same-named Drive files need distinct R2 keys. The Drive ID makes the key
// stable across runs, so a given file always maps to the same object.
export function buildR2Key(prefix, driveName, { disambiguateWith } = {}) {
    const safe = sanitizeDriveName(driveName);
    if (!disambiguateWith) return `${prefix}/${safe}`;
    const { stem, ext } = splitExtension(safe);
    return `${prefix}/${stem} (${String(disambiguateWith).slice(0, 8)})${ext}`;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toTime(value) {
    if (!value) return null;
    const t = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(t) ? null : t;
}

// Reparsing clears the extracted fields, which would destroy an invoice that a
// human already reviewed and submitted to a project.
export function canReparse(record) {
    if (!record) return true;
    if (record.deleted_at) return false;
    if (record.generated_invoice_id) return false;
    if (record.charge_to_project) return false;
    const status = String(record.status || "").trim().toLowerCase();
    return status === "" || status.includes("waiting") || status === "waiting for confirm";
}

/**
 * @param {object} input
 * @param {object} input.driveFile      {id, name, size, modifiedTime}
 * @param {object|null} input.ownedKey  R2 object already known to belong to this Drive ID,
 *                                      as {key, size, lastModified} or null
 * @param {object|null} input.namedKey  R2 object sitting on the plain name, same shape or null
 * @param {object|null} input.record    existing invoices row for this Drive ID, or null
 * @param {string} input.prefix         R2 key prefix
 * @returns {{action: string, key: string, reason: string, reparse: boolean}}
 */
export function planDriveFileSync({ driveFile, ownedKey = null, namedKey = null, record = null, prefix }) {
    const plainKey = buildR2Key(prefix, driveFile?.name);
    const driveSize = toNumber(driveFile?.size);
    const driveModified = toTime(driveFile?.modifiedTime);

    // The file already has an R2 object we know is its own.
    if (ownedKey) {
        const sameSize = driveSize !== null && toNumber(ownedKey.size) === driveSize;
        const r2Time = toTime(ownedKey.lastModified);
        const driveIsNewer = driveModified !== null && r2Time !== null && driveModified > r2Time;

        if (sameSize && !driveIsNewer) {
            return { action: "skip", key: ownedKey.key, reason: "unchanged", reparse: false };
        }
        if (sameSize && driveIsNewer) {
            // Drive bumps modifiedTime for metadata-only edits; identical bytes
            // mean there is nothing new to parse.
            return { action: "skip", key: ownedKey.key, reason: "same size, metadata-only change", reparse: false };
        }
        return {
            action: "replace",
            key: ownedKey.key,
            reason: `drive size ${driveSize} differs from r2 ${toNumber(ownedKey.size)}`,
            reparse: canReparse(record),
        };
    }

    // No object owned by this Drive ID yet.
    if (!namedKey) {
        return { action: "upload", key: plainKey, reason: "new file", reparse: canReparse(record) };
    }

    // Something already occupies the plain name. If this Drive file is the one
    // that put it there, treat it as ours; otherwise it is a name collision.
    const namedSize = toNumber(namedKey.size);
    const recordUsesPlainKey = record && typeof record.file_link_r2 === "string"
        && decodeSafe(record.file_link_r2).endsWith(plainKey);

    if (recordUsesPlainKey) {
        if (driveSize !== null && namedSize === driveSize) {
            return { action: "skip", key: plainKey, reason: "unchanged", reparse: false };
        }
        return {
            action: "replace",
            key: plainKey,
            reason: `drive size ${driveSize} differs from r2 ${namedSize}`,
            reparse: canReparse(record),
        };
    }

    if (driveSize !== null && namedSize === driveSize && !record) {
        // Most likely the same bytes synced before Drive IDs were tracked.
        return { action: "adopt", key: plainKey, reason: "identical bytes already in r2", reparse: false };
    }

    return {
        action: "upload",
        key: buildR2Key(prefix, driveFile?.name, { disambiguateWith: driveFile?.id }),
        reason: "name taken by a different drive file",
        reparse: canReparse(record),
    };
}

function decodeSafe(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
