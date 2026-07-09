const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');

// Register FCM device token
router.post('/register-device', protect, async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }
    // Store FCM token on user record
    const update = {};
    if (platform === 'ios') {
      update['fcmTokens.ios'] = token;
    } else {
      update['fcmTokens.android'] = token;
    }
    await User.findByIdAndUpdate(req.user._id, { $set: update });
    res.json({ message: 'Device registered' });
  } catch (err) {
    console.error('registerDevice error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unregister FCM device token
router.post('/unregister-device', protect, async (req, res) => {
  try {
    const { platform } = req.body;
    const unset = {};
    if (platform === 'ios') {
      unset['fcmTokens.ios'] = '';
    } else {
      unset['fcmTokens.android'] = '';
    }
    await User.findByIdAndUpdate(req.user._id, { $unset: unset });
    res.json({ message: 'Device unregistered' });
  } catch (err) {
    console.error('Failed to unregister device:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;