// Recovered Aircord scene/UI implementation. See PROVENANCE.md.
import * as THREE from "three";

export default function initialize() {
  var n = THREE;
  window.ARCHIVES = {
    el: document.getElementById("json-archives"),
    json: null,
    once() {
      ((this.json = JSON.parse(this.el.textContent)),
        this.json.forEach((t, e) => {
          ((t.preTex = {
            uniqId: t.slug + "_" + e + "_archives",
            workerListener: null,
            objectURL: null,
            loader: new n.TextureLoader(),
            isloaded: !1,
            isloading: !1,
            timer: null,
            tex: null,
            src: t.image.pre,
          }),
            (t.imageTex = {
              uniqId: t.slug + "_" + e + "_archives",
              workerListener: null,
              objectURL: null,
              loader: new n.TextureLoader(),
              isloaded: !1,
              isloading: !1,
              timer: null,
              tex: null,
              src: getSrc(t.image.d1x, t.image.d1x, t.image.mob, t.image.d1x),
            }));
        }));
    },
    selected: null,
    onMouseEnterLoadTexture(t) {
      const e = this.json[t.index];
      (clearTimeout(e.imageTex.timer),
        e.imageTex.isloaded
          ? (WEBGL.archives.onFadeIn(e),
            (e.imageTex.isloading = !1),
            (e.imageTex.isloaded = !0))
          : ((e.imageTex.isloading = !0),
            (e.imageTex.workerListener = (t) => {
              const { id: i, blob: n, error: r } = t.data;
              r ||
                (i === e.imageTex.uniqId &&
                  ((e.imageTex.objectURL = URL.createObjectURL(n)),
                  (e.imageTex.tex = e.imageTex.loader.load(
                    e.imageTex.objectURL,
                    () => {
                      ((e.imageTex.isloading = !1),
                        (e.imageTex.isloaded = !0),
                        URL.revokeObjectURL(e.imageTex.objectURL),
                        (e.imageTex.objectURL = null),
                        WEBGL.archives.onFadeIn(e));
                    },
                  ))));
            }),
            GET_IMAGE_WORKER.addEventListener(
              "message",
              e.imageTex.workerListener,
            ),
            GET_IMAGE_WORKER.postMessage({
              id: e.imageTex.uniqId,
              url: e.imageTex.src,
            })));
    },
    onMouseEnterPreLoadTexture(t) {
      const e = this.json[t.index];
      (clearTimeout(e.preTex.timer),
        (e.imageTex.isloaded && e.imageTex.isloading) ||
          (e.preTex.isloaded
            ? (WEBGL.archives.onFadeInPre(e),
              (e.preTex.isloading = !1),
              (e.preTex.isloaded = !0))
            : ((e.preTex.isloading = !0),
              (e.preTex.workerListener = (t) => {
                const { id: i, blob: n, error: r } = t.data;
                r ||
                  (i === e.preTex.uniqId &&
                    ((e.preTex.objectURL = URL.createObjectURL(n)),
                    (e.preTex.tex = e.preTex.loader.load(
                      e.preTex.objectURL,
                      () => {
                        ((e.preTex.isloading = !1),
                          (e.preTex.isloaded = !0),
                          URL.revokeObjectURL(e.preTex.objectURL),
                          (e.preTex.objectURL = null),
                          WEBGL.archives.onFadeInPre(e));
                      },
                    ))));
              }),
              GET_IMAGE_WORKER.addEventListener(
                "message",
                e.preTex.workerListener,
              ),
              GET_IMAGE_WORKER.postMessage({
                id: e.preTex.uniqId,
                url: e.preTex.src,
              }))));
    },
    onPreLoadTextures() {
      this.json.forEach((t, e) => {
        t.preTex.timer = setTimeout(
          () => {
            t.preTex.isloaded ||
              ((t.preTex.isloading = !0),
              (t.preTex.workerListener = (e) => {
                const { id: i, blob: n, error: r } = e.data;
                r ||
                  (i === t.preTex.uniqId &&
                    ((t.preTex.objectURL = URL.createObjectURL(n)),
                    (t.preTex.tex = t.imageTex.loader.load(
                      t.preTex.objectURL,
                      () => {
                        ((t.preTex.isloading = !1),
                          (t.preTex.isloaded = !0),
                          URL.revokeObjectURL(t.preTex.objectURL),
                          (t.preTex.objectURL = null));
                      },
                    ))));
              }),
              GET_IMAGE_WORKER.addEventListener(
                "message",
                t.preTex.workerListener,
              ),
              GET_IMAGE_WORKER.postMessage({
                id: t.preTex.uniqId,
                url: t.preTex.src,
              }));
          },
          LOAD_CONTROL.archives.d + LOAD_CONTROL.archives.s * e,
        );
      });
    },
    onLoadTextures() {
      this.json.forEach((t, e) => {
        t.imageTex.timer = setTimeout(
          () => {
            t.imageTex.isloaded ||
              ((t.imageTex.isloading = !0),
              (t.imageTex.workerListener = (e) => {
                const { id: i, blob: n, error: r } = e.data;
                r ||
                  (i === t.imageTex.uniqId &&
                    ((t.imageTex.objectURL = URL.createObjectURL(n)),
                    (t.imageTex.tex = t.imageTex.loader.load(
                      t.imageTex.objectURL,
                      () => {
                        ((t.imageTex.isloading = !1),
                          (t.imageTex.isloaded = !0),
                          URL.revokeObjectURL(t.imageTex.objectURL),
                          (t.imageTex.objectURL = null));
                      },
                    ))));
              }),
              GET_IMAGE_WORKER.addEventListener(
                "message",
                t.imageTex.workerListener,
              ),
              GET_IMAGE_WORKER.postMessage({
                id: t.imageTex.uniqId,
                url: t.imageTex.src,
              }));
          },
          LOAD_CONTROL.archives.d + LOAD_CONTROL.archives.s * e,
        );
      });
    },
  };
}
