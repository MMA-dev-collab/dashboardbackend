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

module.exports = { cloudinary, createCloudinaryStorage };
