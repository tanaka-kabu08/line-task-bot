function requireAuth(req, res, next) {
  if (!req.session || !req.session.googleTokens) {
    return res.status(401).json({ error: 'Google認証が必要です', authUrl: '/auth/google' });
  }
  next();
}

module.exports = { requireAuth };
