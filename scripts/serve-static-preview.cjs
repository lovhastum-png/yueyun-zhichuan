const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = Number(process.env.PREVIEW_PORT || 4185);
const host = process.env.PREVIEW_HOST || '0.0.0.0';
const publicRoot = path.resolve(__dirname, '..', 'public');

app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || !/\.(?:js|vrm|glb)$/i.test(req.path)) return next();
  if (!/\bbr\b/.test(req.headers['accept-encoding'] || '')) return next();
  const requestedFile = path.resolve(publicRoot, `.${req.path}`);
  if (!requestedFile.startsWith(`${publicRoot}${path.sep}`)) return next();
  const compressedFile = `${requestedFile}.br`;
  if (!fs.existsSync(compressedFile)) return next();
  res.setHeader('Content-Encoding', 'br');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type(requestedFile);
  res.sendFile(compressedFile);
});
app.use('/assets/3d-stage', express.static(path.join(publicRoot, 'assets', '3d-stage'), { maxAge: '1d' }));
app.use(express.static(publicRoot, { maxAge: 0 }));
app.listen(port, host, () => {
  console.log(`Static preview: http://${host}:${port}`);
});
