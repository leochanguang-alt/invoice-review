import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

function isNotFound(error) {
    return error?.name === "NotFound"
        || error?.name === "NoSuchKey"
        || error?.$metadata?.httpStatusCode === 404;
}

function metadataOf(response) {
    return {
        size: Number(response?.ContentLength),
        etag: String(response?.ETag || "").replace(/^"|"$/g, ""),
        checksum: response?.ChecksumSHA256 || null,
    };
}

function metadataMismatch(source, target) {
    if (source.size !== target.size) {
        return `length mismatch: source ${source.size}, target ${target.size}`;
    }
    if (source.etag && target.etag !== source.etag) {
        return `ETag mismatch: source ${source.etag}, target ${target.etag || "unavailable"}`;
    }
    if (source.checksum && target.checksum !== source.checksum) {
        return "checksum mismatch";
    }
    return null;
}

export async function copyAndVerifyArchive(r2Client, {
    bucketName,
    publicUrl,
    originalKey,
    targetKey,
}) {
    const encodedOriginalKey = originalKey
        .split('/')
        .map(part => encodeURIComponent(part))
        .join('/');

    let source;
    try {
        source = await r2Client.send(new HeadObjectCommand({
            Bucket: bucketName,
            Key: originalKey,
            ChecksumMode: "ENABLED",
        }));
    } catch (error) {
        const reason = error?.message || "unknown R2 HeadObject error";
        throw new Error(
            `Failed to inspect archive source ${originalKey}: ${reason}`,
            { cause: error },
        );
    }
    const sourceMetadata = metadataOf(source);
    if (!(sourceMetadata.size > 0)) {
        throw new Error(`Archive source is missing or empty: ${originalKey}`);
    }

    let existingTarget = null;
    try {
        existingTarget = await r2Client.send(new HeadObjectCommand({
            Bucket: bucketName,
            Key: targetKey,
            ChecksumMode: "ENABLED",
        }));
    } catch (error) {
        if (!isNotFound(error)) {
            throw new Error(
                `Failed to inspect archive target ${targetKey}: ${error?.message || "unknown R2 HeadObject error"}`,
                { cause: error },
            );
        }
    }

    if (existingTarget) {
        const mismatch = metadataMismatch(
            sourceMetadata,
            metadataOf(existingTarget),
        );
        if (mismatch) {
            throw new Error(
                `Refusing to overwrite existing archive target ${targetKey}: metadata mismatch (${mismatch})`,
            );
        }
        return {
            archivedFileId: targetKey,
            archivedLink: `${String(publicUrl || '').replace(/\/+$/, '')}/${targetKey}`,
        };
    }

    await r2Client.send(new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${encodedOriginalKey}`,
        Key: targetKey,
    }));

    const target = await r2Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: targetKey,
        ChecksumMode: "ENABLED",
    }));

    const mismatch = metadataMismatch(sourceMetadata, metadataOf(target));
    if (mismatch) {
        throw new Error(`Archive ${mismatch}`);
    }

    return {
        archivedFileId: targetKey,
        archivedLink: `${String(publicUrl || '').replace(/\/+$/, '')}/${targetKey}`,
    };
}
