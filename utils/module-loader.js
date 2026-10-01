const fs = require("fs").promises;
const path = require("path");

async function listJavaScriptFiles(rootDir) {
  try {
    await fs.access(rootDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

function loadFreshModule(filePath) {
  delete require.cache[require.resolve(filePath)];
  return require(filePath);
}

function toProjectRelativePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

module.exports = {
  listJavaScriptFiles,
  loadFreshModule,
  toProjectRelativePath,
};
