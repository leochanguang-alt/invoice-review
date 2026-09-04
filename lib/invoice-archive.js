import { CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

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
        }));
    } catch (error) {
        const reason = error?.message || "unknown R2 HeadObject error";
        throw new Error(
            `Failed to inspect archive source ${originalKey}: ${reason}`,
            { cause: error },
        );
    }
    const sourceLength = Number(source?.ContentLength);
    if (!(sourceLength > 0)) {
        throw new Error(`Archive source is missing or empty: ${originalKey}`);
    }

    await r2Client.send(new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${encodedOriginalKey}`,
        Key: targetKey,
    }));

    const target = await r2Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: targetKey,
    }));

    const targetLength = Number(target?.ContentLength);
    if (targetLength !== sourceLength) {
        throw new Error(
            `Archive length mismatch: source ${sourceLength}, target ${targetLength}`,
        );
    }

    return {
        archivedFileId: targetKey,
        archivedLink: `${String(publicUrl || '').replace(/\/+$/, '')}/${targetKey}`,
    };
}
