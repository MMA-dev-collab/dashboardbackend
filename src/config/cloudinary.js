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
    params: {
      folder,
      allowed_formats: allowedFormats,
      resource_type: 'auto', // auto-detect image vs raw (pdf, docx, etc.)
    },
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

    // Determine resource type from the URL path (image, raw, or video)
    const resourceType = pathParts[uploadIndex - 1] || 'image';

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

module.exports = { cloudinary, createCloudinaryStorage, getSignedUrl };
