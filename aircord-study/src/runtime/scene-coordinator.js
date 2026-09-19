// Recovered Aircord scene/UI implementation. See PROVENANCE.md.

export default function initialize() {
  WEBGL.scenes = {
    ready: !1,
    once() {
      (this.first.once(),
        this.cameras.once(),
        this.second.once(),
        this.final.once(),
        (this.ready = !0),
        this.onResize());
    },
    onUpdate() {
      (this.cameras.onUpdate(),
        this.first.onUpdate(),
        this.second.onUpdate(),
        this.final.onUpdate());
    },
    onRender() {
      (this.first.onRender(), this.second.onRender(), this.final.onRender());
    },
    onResize() {
      (this.first.onResize(),
        this.second.onResize(),
        this.final.onResize(),
        this.cameras.onResize());
    },
  };
}
