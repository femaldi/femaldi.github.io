const fs = require("fs-extra");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "src");
const out = path.join(root, "dist-renderer");

async function main() {
    await fs.remove(out);
    await fs.ensureDir(out);

    await fs.copy(path.join(src, "index.html"), path.join(out, "index.html"));
    await fs.copy(path.join(src, "sounds"), path.join(out, "sounds"));

    console.log("Renderer prepared:", out);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});