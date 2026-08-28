import { readFile, writeFile } from "node:fs/promises";

const content = await readFile("data/content.json", "utf8");
const assets = await readFile("data/image-assets.json", "utf8");

const bundle = `window.LIAM_CONTENT = ${content};\nwindow.LIAM_IMAGE_ASSETS = ${assets};\n`;

await writeFile("data/content-data.js", bundle);
console.log("Built data/content-data.js");
