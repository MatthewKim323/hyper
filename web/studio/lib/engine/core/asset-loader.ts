/* eslint-disable @typescript-eslint/no-explicit-any */
// AssetLoader. Promise registry + progress events.
// Two instances at boot: store.AssetLoader (event "AssetsProgress") and store.TextLoader ("TextLoaderProgress").
import { Texture, TextureLoader } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import E from "./event-bus";
import { store } from "./store";
import type { TextureOptions } from "./gl";

let sharedKtxLoader: KTX2Loader | null = null;

export class AssetLoader {
  promisesToLoad: Promise<any>[] = [];
  fontsLoaded = false;
  loaded: Promise<void> | false = false;
  name: string;
  progressEventName: string;
  element!: HTMLElement;
  jsons: Record<string, Promise<any>> = {};
  gltfs: Record<string, Promise<GLTF>> = {};
  textures: Record<string, Promise<Texture>> = {};
  ktxTextures: Record<string, Promise<Texture>> = {};
  textureLoader: TextureLoader;
  ktxLoader: KTX2Loader;
  gltfLoader: GLTFLoader;
  dracoLoader: DRACOLoader;

  constructor({ name = "AssetLoader", progressEventName = "AssetsProgress" } = {}) {
    this.name = name;
    this.progressEventName = progressEventName;
    this.textureLoader = new TextureLoader();
    // One shared KTX2Loader (three warns about multiple active instances).
    if (!sharedKtxLoader) {
      sharedKtxLoader = new KTX2Loader();
      sharedKtxLoader.setTranscoderPath(`${store.assetsUrl}basis/`);
    }
    this.ktxLoader = sharedKtxLoader;
    this.gltfLoader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(`${store.assetsUrl}draco/`);
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
  }

  load = ({ element = document.body as HTMLElement | false, progress = true } = {}): Promise<void> => {
    if (element) {
      this.element = element;
      this.addFonts();
      this.addMedia();
    }
    let count = 0;
    if (progress)
      for (let i = 0; i < this.promisesToLoad.length; i++)
        this.promisesToLoad[i].then(() => {
          count++;
          this.progressCallback((100 * count) / this.promisesToLoad.length);
        });
    this.loaded = new Promise<void>((resolve) => {
      Promise.all(this.promisesToLoad).then(() => {
        this.reset();
        E.emit(`${this.name}:beforeResolve`);
        resolve();
        E.emit(`${this.name}:afterResolve`);
      });
    });
    return this.loaded;
  };

  progressCallback = (percent: number) => {
    E.emit(this.progressEventName, { percent: Math.ceil(percent) });
  };

  add = <T>(promise: Promise<T>): Promise<T> => {
    this.promisesToLoad.push(promise);
    return promise;
  };

  addMedia = () => {
    const imgs = this.element.querySelectorAll<HTMLImageElement>('img:not([lazy="full"])');
    for (let t = 0; t < imgs.length; t++) this.addImage(imgs[t]);
    const videos = this.element.querySelectorAll("video");
    for (let e = 0; e < videos.length; e++)
      this.add(
        new Promise<void>((resolve) => {
          const v = videos[e];
          const wasMuted = v.muted;
          v.muted = true;
          v.crossOrigin = "";
          v.addEventListener(
            "loadeddata",
            () => {
              v.addEventListener(
                "timeupdate",
                () => {
                  if (!store.isTouch && v.getAttribute("dom2webgl")) v.pause();
                  resolve();
                  v.currentTime = 0;
                  v.muted = wasMuted;
                },
                { once: true },
              );
            },
            { once: true },
          );
          v.addEventListener("error", () => resolve());
          if (store.isIOS) v.addEventListener("suspend", () => resolve());
          if (v.src === "" && v.dataset.src) v.src = v.dataset.src;
          v.load();
          v.play().catch((err) => {
            console.error(err);
            resolve();
          });
        }),
      );
  };

  addFonts = () => {
    if (document.fonts) this.add(document.fonts.ready);
    if (!this.fontsLoaded && window.Typekit)
      this.add(
        new Promise<void>((resolve) => {
          window.Typekit.load({
            active: () => {
              this.fontsLoaded = true;
              resolve();
            },
          });
        }),
      );
  };

  loadJson = (url: string): Promise<any> => {
    if (!this.jsons[url])
      this.jsons[url] = this.add(
        new Promise((resolve, reject) => {
          fetch(url, { headers: { "Content-Type": "application/json" } }).then((res) => {
            if (!res.ok) throw new Error("Network response was not ok for request: " + url);
            resolve(res.json());
          }, reject);
        }),
      );
    return this.jsons[url];
  };

  loadGltf = (url: string): Promise<GLTF> => {
    if (!this.gltfs[url])
      this.gltfs[url] = this.add(
        new Promise<GLTF>((resolve, reject) => {
          this.gltfLoader.load(
            url,
            (gltf) => resolve(gltf),
            undefined,
            (err) => {
              console.error(err, url);
              reject(err);
            },
          );
        }),
      );
    return this.gltfs[url];
  };

  loadTexture = (url: string, opts?: TextureOptions): Promise<Texture> => {
    if (!this.textures[url])
      this.textures[url] = this.add(
        new Promise<Texture>((resolve, reject) => {
          this.textureLoader.load(
            url,
            (tex) => resolve(store.Gl!.generateTexture(tex, opts)),
            undefined,
            (err) => {
              console.error(err, url);
              reject(err);
            },
          );
        }),
      );
    return this.textures[url];
  };

  reset = () => {
    this.promisesToLoad = [];
  };

  addImage(img: HTMLImageElement) {
    return this.add(
      new Promise<HTMLImageElement>((resolve) => {
        if (img.complete && img.naturalWidth !== 0) resolve(img);
        else {
          img.addEventListener("load", () => resolve(img));
          img.addEventListener("error", () => resolve(img));
        }
      }),
    );
  }

  loadKtxTexture(url: string, opts?: TextureOptions): Promise<Texture> {
    if (!this.ktxTextures[url])
      this.ktxTextures[url] = this.add(
        new Promise<Texture>((resolve, reject) => {
          this.ktxLoader.load(
            url,
            (tex) => resolve(store.Gl!.generateTexture(tex, opts, true)),
            undefined,
            (err: any) => {
              console.error(err, err?.name, err?.stack, err?.message, err?.cause, url);
              console.dir(err);
              reject(err);
            },
          );
        }),
      );
    return this.ktxTextures[url];
  }
}
