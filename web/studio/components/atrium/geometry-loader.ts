import type { BufferGeometry, LoadingManager } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type AtriumGeometryLoader = {
  loadAsync: GLTFLoader["loadAsync"];
  dispose(): void;
};

const DRACO_EXTENSION = "KHR_draco_mesh_compression";
const ATTRIBUTE_NAMES: Record<string, string> = { POSITION: "position", NORMAL: "normal", TANGENT: "tangent", TEXCOORD_0: "uv", TEXCOORD_1: "uv2", COLOR_0: "color", WEIGHTS_0: "skinWeight", JOINTS_0: "skinIndex" };
const COMPONENT_TYPES: Record<number, string> = { 5120: "Int8Array", 5121: "Uint8Array", 5122: "Int16Array", 5123: "Uint16Array", 5125: "Uint32Array", 5126: "Float32Array" };
type DracoTask = { attributeIDs: Record<string, number>; attributeTypes: Record<string, string>; useUniqueIDs: boolean };
type DracoPrimitive = { attributes: Record<string, number>; extensions: { KHR_draco_mesh_compression: { bufferView: number; attributes: Record<string, number> } } };
type RuntimeDecoder = DRACOLoader & { decodeGeometry(buffer: ArrayBuffer, task: DracoTask): Promise<BufferGeometry>; workerSourceURL?: string };

/** One decoder pool for both the compressed room and ordinary station GLBs. */
export function createAtriumGeometryLoader(manager?: LoadingManager): AtriumGeometryLoader {
  const decoder = new DRACOLoader(manager)
    .setDecoderPath("/assets/draco/")
    .setWorkerLimit(2) as RuntimeDecoder;
  // r143's eager preload drops decoder-download rejections. The first actual
  // decode starts the same initialization through an observed promise instead.
  decoder.preload = () => decoder;
  const gltf = new GLTFLoader(manager).setDRACOLoader(decoder);
  let disposed = false;
  let released = false;
  let pending = 0;
  let primitives = 0;

  gltf.register(parser => ({
    name: "HyperDracoErrorPropagation",
    beforeRoot() {
      const extension = parser.extensions[DRACO_EXTENSION];
      if (!extension) return null;
      // The pinned GLTFLoader wraps decodeDracoFile in a resolve-only promise.
      // Replace that one extension method so failed decode jobs reject the
      // normal parser/loadAsync chain instead of hanging forever.
      extension.decodePrimitive = async (primitive: DracoPrimitive) => {
        primitives += 1;
        try {
          if (disposed) throw new DOMException("The atrium geometry loader is disposed.", "AbortError");
          const compressed = primitive.extensions.KHR_draco_mesh_compression;
          const attributeIDs: Record<string, number> = {};
          const attributeTypes: Record<string, string> = {};
          const normalized: Record<string, boolean> = {};
          for (const [semantic, id] of Object.entries(compressed.attributes)) {
            const name = ATTRIBUTE_NAMES[semantic] ?? semantic.toLowerCase();
            const accessor = parser.json.accessors[primitive.attributes[semantic]] as { componentType: number; normalized?: boolean };
            attributeIDs[name] = id;
            attributeTypes[name] = COMPONENT_TYPES[accessor.componentType];
            normalized[name] = accessor.normalized === true;
          }
          const buffer = await parser.getDependency("bufferView", compressed.bufferView) as ArrayBuffer;
          if (disposed) throw new DOMException("The atrium geometry loader is disposed.", "AbortError");
          const geometry = await decoder.decodeGeometry(buffer, { attributeIDs, attributeTypes, useUniqueIDs: true });
          for (const [name, attribute] of Object.entries(geometry.attributes)) {
            if (name in normalized) attribute.normalized = normalized[name];
          }
          return geometry;
        } finally {
          primitives -= 1;
          releaseWhenIdle();
        }
      };
      return null;
    },
  }));

  function releaseWhenIdle() {
    if (!disposed || released || pending > 0 || primitives > 0) return;
    released = true;
    decoder.dispose();
    // Three r143 terminates its workers but leaves the generated worker URL.
    // This field belongs to that pinned version and is not exposed in its types.
    if (decoder.workerSourceURL) {
      URL.revokeObjectURL(decoder.workerSourceURL);
      decoder.workerSourceURL = "";
    }
  }

  return {
    async loadAsync(url, onProgress) {
      if (disposed) throw new DOMException("The atrium geometry loader is disposed.", "AbortError");
      pending += 1;
      try {
        return await gltf.loadAsync(url, onProgress);
      } finally {
        pending -= 1;
        releaseWhenIdle();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // r143 has no decode cancellation. Let an active request settle so the
      // renderer can dispose its late model, then terminate every worker.
      releaseWhenIdle();
    },
  };
}
