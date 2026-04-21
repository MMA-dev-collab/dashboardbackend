const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const settingsController = require('./growth-settings.controller');
const { updateSettingsSchema } = require('./growth-settings.validator');
const { validate } = require('../../middleware/validate');

const router = Router();

router.use(authenticate);

router.get('/', settingsController.getSettings);
router.patch('/', validate(updateSettingsSchema), settingsController.updateSettings);

module.exports = router;
