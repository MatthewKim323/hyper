import { strict as assert } from "node:assert";
import { describe, test, type TestContext } from "node:test";
import { LinearEncoding, LinearMipmapLinearFilter, MirroredRepeatWrapping, Texture, TextureLoader } from "three";
import { createMarbleSurface, MARBLE_TEXTURE_URL } from "./marble";

function loading(t: TestContext) {
  const original = TextureLoader.prototype.loadAsync;
  let resolve!: (texture: Texture) => void;
  const pending = new Promise<Texture>(done => { resolve = done; });
  const calls: string[] = [];
  TextureLoader.prototype.loadAsync = url => { calls.push(url); return pending; };
  t.after(() => { TextureLoader.prototype.loadAsync = original; });
  return { resolve, calls };
}

describe("shared marble texture ownership", { concurrency: false }, () => {
  test("deduplicates loads, configures surface filtering and disposes each texture once", async t => {
    const { resolve, calls } = loading(t);
    const marble = createMarbleSurface(16);
    const texture = new Texture();
    let fallbackDisposals = 0, textureDisposals = 0;
    marble.albedo.value.addEventListener("dispose", () => { fallbackDisposals++; });
    texture.addEventListener("dispose", () => { textureDisposals++; });
    const loaded = marble.load();
    assert.equal(marble.load(), loaded);
    resolve(texture);
    await loaded;
    assert.deepEqual(calls, [MARBLE_TEXTURE_URL]);
    assert.equal(fallbackDisposals, 1);
    assert.equal(marble.albedo.value, texture);
    assert.equal(texture.encoding, LinearEncoding);
    assert.equal(texture.wrapS, MirroredRepeatWrapping);
    assert.equal(texture.wrapT, MirroredRepeatWrapping);
    assert.equal(texture.minFilter, LinearMipmapLinearFilter);
    assert.equal(texture.anisotropy, 8);
    marble.dispose(); marble.dispose();
    assert.equal(textureDisposals, 1);
  });

  test("releases a texture that arrives after navigation has disposed the scene", async t => {
    const { resolve } = loading(t);
    const marble = createMarbleSurface(4);
    const fallback = marble.albedo.value;
    const texture = new Texture();
    let disposals = 0;
    texture.addEventListener("dispose", () => { disposals++; });
    const loaded = marble.load();
    marble.dispose();
    resolve(texture);
    await loaded;
    assert.equal(disposals, 1);
    assert.equal(marble.albedo.value, fallback);
  });
});
