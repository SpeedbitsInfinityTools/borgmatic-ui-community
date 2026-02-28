import React from 'react';
import { Shield, FileText, AlertTriangle } from 'lucide-react';
import { Repository } from '../types/repositories';
import { toast } from 'react-hot-toast';

/**
 * Comprehensive path normalization for all cloud/remote paths
 */
export const normalizePath = (path: string, pathType: 'cloud' | 'local' = 'cloud'): string => {
  if (!path || path.trim() === '') return '';

  let normalized = path.trim();

  // Convert backslashes to forward slashes (Windows compatibility)
  normalized = normalized.replace(/\\/g, '/');

  // Remove multiple consecutive slashes
  normalized = normalized.replace(/\/+/g, '/');

  if (pathType === 'cloud') {
    // For cloud paths (Rclone/S3): remove leading and trailing slashes
    normalized = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
  } else {
    // For local paths: keep leading slash for absolute paths
    if (!normalized.startsWith('/')) {
      // Make relative paths absolute
      normalized = '/' + normalized;
    }
    // Remove trailing slash (except for root)
    if (normalized !== '/' && normalized.endsWith('/')) {
      normalized = normalized.replace(/\/+$/, '');
    }
  }

  // Security: Block path traversal
  if (normalized.includes('..')) {
    toast.error('Invalid path: ".." is not allowed for security reasons');
    return '';
  }

  // Security: Block shell metacharacters and other dangerous characters
  const dangerousChars = /[;&|`$()<>{}[\]]/;
  if (dangerousChars.test(normalized)) {
    toast.error('Invalid path: Special characters (;&|`$()<>{}[]) are not allowed');
    return '';
  }

  // Additional validation: Only allow alphanumeric, dash, underscore, dot, forward slash, space
  const allowedChars = /^[a-zA-Z0-9._\-/ ]+$/;
  if (!allowedChars.test(normalized)) {
    toast.error('Invalid path: Only letters, numbers, dash, underscore, dot, slash, and space are allowed');
    return '';
  }

  return normalized;
};

/**
 * Legacy function for backward compatibility
 */
export const normalizeRclonePath = (path: string): string => {
  return normalizePath(path, 'cloud');
};

/**
 * Mask sensitive credentials in S3 URLs for display
 * Input:  s3:ACCESS_KEY:SECRET_KEY@https://endpoint/bucket/path
 * Output: s3:***@https://endpoint/bucket/path
 */
export const maskS3Credentials = (path: string): string => {
  if (!path) return path;

  // Check if this is an S3 path with credentials
  // Format: s3:ACCESS_KEY:SECRET_KEY@https://...
  const s3Match = path.match(/^s3:([^:]+):([^@]+)@(.+)$/);
  if (s3Match) {
    const endpoint = s3Match[3]; // Everything after @
    return 's3:***@' + endpoint;
  }

  return path;
};

/**
 * Get display-safe repository path (masks credentials)
 */
export const getSafeDisplayPath = (path: string): string => {
  if (!path) return path;

  // Mask S3 credentials
  if (path.startsWith('s3:')) {
    return maskS3Credentials(path);
  }

  return path;
};

/**
 * Format repository path with type prefix for display (masks sensitive credentials)
 */
export const getDisplayPath = (repository: Repository): string => {
  const type = repository.repository_type || 'local';

  switch (type) {
    case 'rclone': {
      // For rclone, show: rclone:remotename/path (handle empty/undefined paths gracefully)
      const rclonePath = repository.rclone_path || '';
      const normalizedPath = rclonePath.replace(/^\/+/, ''); // Remove leading slashes
      return `rclone:${repository.rclone_remote || 'unknown'}${normalizedPath ? '/' + normalizedPath : ''}`;
    }
    case 's3': {
      // Mask S3 credentials for security
      const s3Path = repository.path.startsWith('s3:') ? repository.path : 's3:' + repository.path;
      return maskS3Credentials(s3Path);
    }
    case 'ssh':
      // Path is already in format ssh://user@host:port/path, just return as-is
      return repository.path.startsWith('ssh://') ? repository.path : `ssh://${repository.path}`;
    case 'sftp':
      // Path is already in format ssh://user@host:port/path, just return as-is
      return repository.path.startsWith('ssh://') ? repository.path : `ssh://${repository.path}`;
    case 'local':
    default:
      return `local:${repository.path}`;
  }
};

/**
 * Get encryption icon component
 */
export const getEncryptionIcon = (encryption: string): JSX.Element => {
  switch (encryption) {
    case 'repokey':
      return <Shield className="w-4 h-4 text-green-500" />;
    case 'keyfile':
      return <FileText className="w-4 h-4 text-blue-500" />;
    case 'none':
      return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
    default:
      return <Shield className="w-4 h-4 text-gray-500" />;
  }
};

/**
 * Get compression label
 */
export const getCompressionLabel = (compression: string): string => {
  switch (compression) {
    case 'lz4':
      return 'LZ4 (Fast)';
    case 'zstd':
      return 'Zstandard';
    case 'zlib':
      return 'Zlib';
    case 'none':
      return 'None';
    default:
      return compression;
  }
};

/**
 * Get encryption description (Borg 2.0 AEAD modes)
 */
export const getEncryptionDescription = (encryption: string): string => {
  switch (encryption) {
    // Borg 2.0 recommended modes (AEAD)
    case 'repokey-blake2-aes-ocb':
      return '🌟 Recommended: AES-256-OCB (AEAD) + BLAKE2b chunk ID. Fast on modern CPUs. Key in repo.';
    case 'repokey-aes-ocb':
      return 'AES-256-OCB (AEAD). Fast on CPUs with AES-NI. Key stored in repository.';
    case 'repokey-blake2-chacha20-poly1305':
      return '🔐 ChaCha20-Poly1305 (AEAD) + BLAKE2b. Best for older CPUs without AES-NI. Key in repo.';
    case 'repokey-chacha20-poly1305':
      return 'ChaCha20-Poly1305 (AEAD). Good for CPUs without AES-NI. Key stored in repository.';
    case 'keyfile-blake2-aes-ocb':
      return '🔒 Maximum security: AES-256-OCB + BLAKE2b, key stored separately. Must backup key file!';
    case 'keyfile-aes-ocb':
      return 'AES-256-OCB (AEAD), key stored separately. Must backup key file!';
    case 'keyfile-blake2-chacha20-poly1305':
      return '🔒 ChaCha20-Poly1305 + BLAKE2b, key stored separately. Must backup key file!';
    case 'keyfile-chacha20-poly1305':
      return 'ChaCha20-Poly1305 (AEAD), key stored separately. Must backup key file!';
    case 'authenticated-blake2':
      return '⚠️ Authenticated but NOT encrypted. Data integrity verified, but readable by anyone.';
    case 'authenticated':
      return '⚠️ Authenticated but NOT encrypted. Data integrity verified, but readable by anyone.';
    case 'none':
      return '🚫 No encryption or authentication - NOT recommended! Data stored in plain text.';
    // Legacy Borg 1.x modes (still work but deprecated)
    case 'repokey-blake2':
      return '⚠️ Legacy (Borg 1.x): Use repokey-blake2-aes-ocb for Borg 2.0.';
    case 'repokey':
      return '⚠️ Legacy (Borg 1.x): Use repokey-aes-ocb for Borg 2.0.';
    case 'keyfile-blake2':
      return '⚠️ Legacy (Borg 1.x): Use keyfile-blake2-aes-ocb for Borg 2.0.';
    case 'keyfile':
      return '⚠️ Legacy (Borg 1.x): Use keyfile-aes-ocb for Borg 2.0.';
    default:
      return encryption ? `Encryption mode: ${encryption}` : '';
  }
};

/**
 * Get compression description
 */
export const getCompressionDescription = (compression: string): string => {
  switch (compression) {
    case 'lz4':
      return '⚡ Very fast compression with decent ratio. Best for most use cases.';
    case 'zstd':
      return '⚖️ Balanced compression - better ratio than LZ4, still fast. Good for large backups.';
    case 'zlib':
      return '📦 High compression ratio but slower. Best when storage space is limited.';
    case 'lzma':
      return '🗜️ Maximum compression but very slow. Use only if storage is critical.';
    case 'none':
      return '🚫 No compression - fastest but uses most storage space.';
    default:
      return '';
  }
};
