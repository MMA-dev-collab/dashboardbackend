const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const env = require('./env');

// Configure the Cloudinary SDK
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

/**
 * Create a multer-storage-cloudinary instance.
 * @param {string} folder  - Cloudinary folder name, e.g. 'egycodera/documents'
 * @param {string[]} allowedFormats - e.g. ['pdf','png','jpg','jpeg']
 * @returns {CloudinaryStorage}
 */
function createCloudinaryStorage(folder, allowedFormats) {
  return new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
      folder,
      allowed_formats: allowedFormats,
      // Force PDFs and docs to 'raw', everything else auto
      resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'auto',
    }),
  });
}

/**
 * Generate a signed Cloudinary URL from an existing Cloudinary URL.
 * This is needed because Cloudinary returns 401 for certain file types
 * (e.g. PDFs) when accessed via unsigned URLs.
 * @param {string} originalUrl - The stored Cloudinary URL
 * @returns {string} A signed URL, or the original URL if parsing fails
 */
function getSignedUrl(originalUrl) {
  try {
    const url = new URL(originalUrl);
    const pathParts = url.pathname.split('/');
    const uploadIndex = pathParts.indexOf('upload');
    if (uploadIndex === -1) return originalUrl;

    // Get public ID (skip version segment like v1772876403)
    const afterUpload = pathParts.slice(uploadIndex + 1);
    const startIdx = /^v\d+$/.test(afterUpload[0]) ? 1 : 0;
    const publicIdWithExt = afterUpload.slice(startIdx).join('/');

    // Force PDFs to use 'raw' regardless of what the stored URL says
    const isPdf = publicIdWithExt.toLowerCase().endsWith('.pdf');
    const resourceType = isPdf ? 'raw' : (pathParts[uploadIndex - 1] || 'image');

    return cloudinary.url(publicIdWithExt, {
      sign_url: true,
      resource_type: resourceType,
      type: 'upload',
      secure: true,
    });
  } catch {
    return originalUrl;
  }
}

/**
 * Get MIME type from a file extension.
 * Cloudinary returns application/octet-stream for raw files,
 * so we need to determine the correct MIME type from the extension.
 * @param {string} ext - File extension without dot (e.g. 'pdf', 'jpg')
 * @returns {string|null} MIME type or null if unknown
 */
function getMimeFromExt(ext) {
  const map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv',
    txt: 'text/plain',
    md: 'text/markdown',
    zip: 'application/zip',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
  };
  return map[ext] || null;
}

module.exports = { cloudinary, createCloudinaryStorage, getSignedUrl, getMimeFromExt };
