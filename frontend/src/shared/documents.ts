import { api } from '../core/api/client';

export type AccessLevel = 'PUBLIC' | 'PRIVATE' | 'PROTECTED' | 'RESTRICTED';

export type DocItem = {
    id: string;
    instanceId: string | null;
    title: string;
    description: string | null;
    docNumber: string | null;
    accessLevel: AccessLevel;
    expiresAt: string | null;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
    uploadedBy: { id: string; name: string };
    expired: boolean;
};
export type DocPage = { items: DocItem[]; total: number; page: number; limit: number };

export const ACCESS_LABEL: Record<AccessLevel, string> = {
    PUBLIC: 'Public',
    PRIVATE: 'Private',
    PROTECTED: 'Protected',
    RESTRICTED: 'Restricted',
};
export const ACCESS_COLOR: Record<AccessLevel, string> = {
    PUBLIC: 'green',
    PRIVATE: 'gold',
    PROTECTED: 'orange',
    RESTRICTED: 'red',
};

export const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'doc', 'xls', 'csv', 'txt'];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// A quick check before uploading. The server checks again, including the real file contents.
export function checkFileBeforeUpload(file: File): string | null {
    const dot = file.name.lastIndexOf('.');
    const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return `This file type is not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
    }
    if (file.size === 0) return 'The file is empty';
    if (file.size > MAX_FILE_BYTES) return 'File too large (max 10 MB)';
    return null;
}

export const formatSize = (n: number) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

// The link works for 60 seconds. For S3 it is a direct link, for local disk it goes through the API.
export async function downloadDocument(id: string): Promise<void> {
    const { url } = await api<{ url: string }>(`/documents/${id}/download-url`);
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}