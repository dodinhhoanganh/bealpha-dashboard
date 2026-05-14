const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

// Replace audio block
code = code.replace(
/      if \(req\.body\.isTemp === "true"\) \{\s+folderParts = \["uploads", "temp", "audio", crypto\.randomUUID\(\)\];\s+\}\s+const destDir = path\.join\(__dirname, \.\.\.folderParts\);\s+\/\/ Xóa file cũ của track này nếu có \(vì thư mục này chỉ dành cho 1 track\)\s+if \(fs\.existsSync\(destDir\) && req\.body\.isTemp !== "true"\) \{\s+try \{\s+const files = fs\.readdirSync\(destDir\);\s+for \(const f of files\) \{\s+fs\.unlinkSync\(path\.join\(destDir, f\)\);\s+\}\s+\} catch \(e\) \{\s+console\.error\("Failed to clean up old audio files in:", destDir, e\);\s+\}\s+\} else if \(!fs\.existsSync\(destDir\)\) \{\s+fs\.mkdirSync\(destDir, \{ recursive: true \}\);\s+\}/,
`      const destDir = req.body.isTemp === "true" ? req.file.destination : path.join(__dirname, ...folderParts);

      // Xóa file cũ của track này nếu có (vì thư mục này chỉ dành cho 1 track)
      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try {
          const files = fs.readdirSync(destDir);
          for (const f of files) {
            const filePath = path.join(destDir, f);
            if (filePath !== req.file.path) fs.unlinkSync(filePath);
          }
        } catch (e) {
          console.error("Failed to clean up old audio files in:", destDir, e);
        }
      } else if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }`
);

// Replace other blocks (video, canvas, motion, tidal-artwork, amazon-artwork)
const otherRegex = /      if \(req\.body\.isTemp === "true"\) folderParts = \["uploads", "temp", "([^\"]+)", crypto\.randomUUID\(\)\];\s+const destDir = path\.join\(__dirname, \.\.\.folderParts\);\s+if \(fs\.existsSync\(destDir\) && req\.body\.isTemp !== "true"\) \{\s+try \{ fs\.readdirSync\(destDir\)\.forEach\(f => fs\.unlinkSync\(path\.join\(destDir, f\)\)\); \} catch \(e\) \{\}\s+\} else if \(!fs\.existsSync\(destDir\)\) \{\s+fs\.mkdirSync\(destDir, \{ recursive: true \}\);\s+\}/g;

code = code.replace(otherRegex, (match, type) => {
  return `      const destDir = req.body.isTemp === "true" ? req.file.destination : path.join(__dirname, ...folderParts);

      if (fs.existsSync(destDir) && req.body.isTemp !== "true") {
        try { fs.readdirSync(destDir).forEach(f => {
          const filePath = path.join(destDir, f);
          if (filePath !== req.file.path) fs.unlinkSync(filePath);
        }); } catch (e) {}
      } else if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }`;
});

fs.writeFileSync('server.js', code);
console.log('Fixed server.js');
