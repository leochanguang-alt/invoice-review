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

    await r2Client.send(new CopyObjectCommand({
        Bucket: bucketName,
        CopySource: `${bucketName}/${encodedOriginalKey}`,
        Key: targetKey,
    }));

    const target = await r2Client.send(new HeadObjectCommand({
        Bucket: bucketName,
        Key: targetKey,
    }));

    if (!(Number(target?.ContentLength) > 0)) {
        throw new Error(`Archive target is missing or empty: ${targetKey}`);
    }

    return {
        archivedFileId: targetKey,
        archivedLink: `${String(publicUrl || '').replace(/\/+$/, '')}/${targetKey}`,
    };
}
