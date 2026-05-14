const fs = require('fs');
const path = require('path');
let code = fs.readFileSync('server.js', 'utf8');

const endpoints = `
// ==========================================
// APPLE MUSIC MOTION UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/motion",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadAudioOriginal.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "motion", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "motion", require('crypto').randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const currentPath = req.file.path;
      try {
        const header = await readFileHeader(currentPath, 12);
        if (!isVideoHeader(header)) {
          try { fs.unlinkSync(currentPath); } catch { }
          return res.status(400).json({ error: "ERROR_MOTION_MUST_BE_A_VALID_MP4_MOV_FILE" });
        }

        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".mp4";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\\\/g, "/"),
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { }
        }
        console.error("[Motion] POST /upload/motion error:", err.message || err);
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  },
);

// ==========================================
// TIDAL ARTWORK UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/tidal-artwork",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadImage.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "tidal-artwork", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "tidal-artwork", require('crypto').randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const currentPath = req.file.path;
      try {
        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".png";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\\\/g, "/"),
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { }
        }
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  },
);

// ==========================================
// AMAZON ARTWORK UPLOAD ENDPOINT
// ==========================================
app.post(
  "/upload/amazon-artwork",
  requireApiKey,
  checkUploadConcurrency,
  (req, res, next) => {
    uploadImage.single("file")(req, res, async (err) => {
      if (err) return next(err);
      if (!req.file) return res.status(400).json({ error: "ERROR_NO_FILE_UPLOADED" });

      const releaseId = req.body.releaseId;
      const safeReleaseId = sanitizeFilename(releaseId || "standalone");

      let folderParts = ["uploads", "amazon-artwork", safeReleaseId];
      if (req.body.isTemp === "true") folderParts = ["uploads", "temp", "amazon-artwork", require('crypto').randomUUID()];
      const destDir = path.join(__dirname, ...folderParts);

      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

      const currentPath = req.file.path;
      try {
        const finalExt = path.extname(req.file.originalname).toLowerCase() || ".png";
        const rawSafe = sanitizeFilename(req.file.originalname);
        const finalName = path.basename(rawSafe, finalExt) + finalExt;
        const destPath = path.join(destDir, finalName);

        try { fs.copyFileSync(currentPath, destPath); } catch(e) {}
        try { fs.unlinkSync(currentPath); } catch { }

        const fileUrl = "/" + require("path").relative(__dirname, destPath).split(require("path").sep).map(encodeURIComponent).join("/");

        res.json({
          success: true,
          filename: req.file.filename,
          originalName: sanitizeFilename(req.file.originalname),
          url: fileUrl,
          size: req.file.size,
          mimetype: req.file.mimetype,
          storagePath: require("path").relative(require("path").join(__dirname, "uploads"), destPath).replace(/\\\\/g, "/"),
        });
      } catch (err) {
        if (currentPath && fs.existsSync(currentPath)) {
          try { fs.unlinkSync(currentPath); } catch { }
        }
        return res.status(500).json({ error: "ERROR_INTERNAL_SERVER_ERROR" });
      }
    });
  },
);
`;

const insertIndex = code.indexOf('app.get("/hls/status/*"');
code = code.substring(0, insertIndex) + endpoints + '\n' + code.substring(insertIndex);

fs.writeFileSync('server.js', code);
console.log('Endpoints restored successfully');
