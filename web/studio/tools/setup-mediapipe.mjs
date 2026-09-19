// Hand cursor assets: copies the MediaPipe wasm runtime out of node_modules and fetches the
// hand landmark model into public/mediapipe (gitignored). Runs on postinstall; safe to re-run.
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public/mediapipe");
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const exists = (path) => stat(path).then((s) => s.size > 0, () => false);

await mkdir(join(out, "wasm"), { recursive: true });
for (const name of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"])
  await copyFile(join(root, "node_modules/@mediapipe/tasks-vision/wasm", name), join(out, "wasm", name));

const model = join(out, "hand_landmarker.task");
if (!(await exists(model))) {
  const response = await fetch(MODEL);
  if (!response.ok) throw new Error(`hand model download failed: ${response.status}`);
  await writeFile(model, Buffer.from(await response.arrayBuffer()));
}
console.log("mediapipe assets ready");
