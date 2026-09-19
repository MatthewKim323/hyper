// notFound renderer: 404 view, grain-only screen FX.
import gsap from "gsap";
import { store as storeRaw } from "../../core/store";
import { BaseRenderer } from "./base";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store: any = storeRaw;

export class NotFoundRenderer extends BaseRenderer {
  onEnter() {
    super.onEnter();
    store.Gl.composer.readBuffer.dispose();
    store.Gl.screenFxPass.uniforms.u_noiseOnly.value = 1;
  }

  onLeave() {
    super.onLeave();
    gsap.to(store.Gl.screenFxPass.uniforms.u_noiseOnly, { value: 0, ease: "power2.out", duration: 1, delay: 2 });
  }
}

export default NotFoundRenderer;
