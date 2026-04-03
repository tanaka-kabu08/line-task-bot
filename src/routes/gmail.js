const express = require('express');
const router = express.Router();
const gmailService = require('../services/gmailService');
const { requireAuth } = require('../middleware/auth');

// POST /api/gmail/scan
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const tokens = req.session.googleTokens;
    const tasks = await gmailService.scanEmails(tokens);
    res.json({ tasks });
  } catch (error) {
    console.error('Gmail scan error:', error.message);
    res.status(500).json({ error: 'Gmailのスキャンに失敗しました', detail: error.message });
  }
});

module.exports = router;
