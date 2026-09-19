import {
  LinearFilter,
  Matrix4,
  Mesh,
  Plane,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type BufferGeometry,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type ShaderMaterial,
} from 'three';
import { store as storeRaw } from '../../core/store';
import { E } from '../../core/event-bus';
import { PackedMipMapGenerator } from './packed-mipmap-generator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const o: any = storeRaw;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const n: any = E;

/**
 * Planar mirror with a packed mip-mapped reflection target.
 * The reflection is rendered from `onBeforeRender` of the mirror mesh itself.
 */
export class Reflector extends Mesh<BufferGeometry, ShaderMaterial> {
  ignoreObjects: Object3D[];
  renderReflection: boolean;
  camera: PerspectiveCamera | null;
  scene: Scene | null;
  sceneCamera: PerspectiveCamera | null;
  reflectorPlane: Plane;
  normal: Vector3;
  reflectorWorldPosition: Vector3;
  cameraWorldPosition: Vector3;
  rotationMatrix: Matrix4;
  lookAtPosition: Vector3;
  clipPlane: Vector4;
  view: Vector3;
  target: Vector3;
  q: Vector4;
  textureSize: Vector2;
  textureMatrix: Matrix4;
  renderTarget: WebGLRenderTarget;
  mipmapper: PackedMipMapGenerator;

  onResize = () => {
    this.textureSize.set(0.5 * o.window.w, 0.5 * o.window.fullHeight);
    this.mipmapper.resize(this.textureSize, this.renderTarget);
  };

  constructor(e: BufferGeometry, t: ShaderMaterial, i: string) {
    super(e, t);
    this.name = i;
    this.ignoreObjects = [];
    this.renderReflection = true;
    this.camera = null;
    this.scene = null;
    this.sceneCamera = null;
    this.reflectorPlane = new Plane();
    this.normal = new Vector3();
    this.reflectorWorldPosition = new Vector3();
    this.cameraWorldPosition = new Vector3();
    this.rotationMatrix = new Matrix4();
    this.lookAtPosition = new Vector3(0, 0, -1);
    this.clipPlane = new Vector4();
    this.view = new Vector3();
    this.target = new Vector3();
    this.q = new Vector4();
    this.textureSize = new Vector2(0.5 * o.window.w, 0.5 * o.window.fullHeight);
    this.textureMatrix = new Matrix4();
    this.renderTarget = new WebGLRenderTarget(this.textureSize.x, this.textureSize.y, {
      minFilter: LinearFilter,
    });
    this.mipmapper = new PackedMipMapGenerator();
    this.mipmapper.resize(this.textureSize, this.renderTarget);
    this.material.uniforms.uTextureMatrix = { value: this.textureMatrix };
    this.material.uniforms.uTexture = { value: this.renderTarget.texture };
    this.material.uniforms.uMipmapTextureSize = { value: this.mipmapper.targetSize };
    this.matrixAutoUpdate = false;
    n.on(o.events.RESIZE, this.onResize);
  }

  onBeforeRender = () => {
    const sceneCamera = this.sceneCamera as PerspectiveCamera;
    const camera = this.camera as PerspectiveCamera;
    this.reflectorWorldPosition.setFromMatrixPosition(this.matrixWorld);
    this.cameraWorldPosition.setFromMatrixPosition(sceneCamera.matrixWorld);
    this.rotationMatrix.extractRotation(this.matrixWorld);
    this.normal.set(0, 0, 1);
    this.normal.applyMatrix4(this.rotationMatrix);
    this.view.subVectors(this.reflectorWorldPosition, this.cameraWorldPosition);
    if (this.view.dot(this.normal) > 0) return;
    this.view.reflect(this.normal).negate();
    this.view.add(this.reflectorWorldPosition);
    this.rotationMatrix.extractRotation(sceneCamera.matrixWorld);
    this.lookAtPosition.set(0, 0, -1);
    this.lookAtPosition.applyMatrix4(this.rotationMatrix);
    this.lookAtPosition.add(this.cameraWorldPosition);
    this.target.subVectors(this.reflectorWorldPosition, this.lookAtPosition);
    this.target.reflect(this.normal).negate();
    this.target.add(this.reflectorWorldPosition);
    camera.position.copy(this.view);
    camera.up.set(0, 1, 0);
    camera.up.applyMatrix4(this.rotationMatrix);
    camera.up.reflect(this.normal);
    camera.lookAt(this.target);
    camera.far = sceneCamera.far;
    camera.updateMatrixWorld();
    camera.projectionMatrix.copy(sceneCamera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(camera.projectionMatrix);
    this.textureMatrix.multiply(camera.matrixWorldInverse);
    this.textureMatrix.multiply(this.matrixWorld);
    this.reflectorPlane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorWorldPosition);
    this.reflectorPlane.applyMatrix4(camera.matrixWorldInverse);
    this.clipPlane.set(
      this.reflectorPlane.normal.x,
      this.reflectorPlane.normal.y,
      this.reflectorPlane.normal.z,
      this.reflectorPlane.constant,
    );
    const e = camera.projectionMatrix;
    this.q.x = (Math.sign(this.clipPlane.x) + e.elements[8]) / e.elements[0];
    this.q.y = (Math.sign(this.clipPlane.y) + e.elements[9]) / e.elements[5];
    this.q.z = -1;
    this.q.w = (1 + e.elements[10]) / e.elements[14];
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    e.elements[2] = this.clipPlane.x;
    e.elements[6] = this.clipPlane.y;
    e.elements[10] = this.clipPlane.z + 1 - 0.003;
    e.elements[14] = this.clipPlane.w;
    this.visible = false;
    for (let i = 0; i < this.ignoreObjects.length; i++) this.ignoreObjects[i].visible = false;
    if (this.renderReflection) {
      const renderer = o.Gl.renderer;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.renderTarget);
      renderer.setViewport(
        0,
        0,
        this.textureSize.x / renderer.getPixelRatio(),
        this.textureSize.y / renderer.getPixelRatio(),
      );
      renderer.setScissor(0, 0, this.textureSize.x, this.textureSize.y);
      renderer.setScissorTest(true);
      renderer.clear(true);
      renderer.render(this.scene as Scene, camera);
      renderer.setRenderTarget(null);
      renderer.setViewport(0, 0, o.window.w, o.window.fullHeight);
      renderer.setScissor(0, 0, o.window.w, o.window.fullHeight);
      renderer.setRenderTarget(prev);
      this.mipmapper.update(this.renderTarget.texture, this.renderTarget, renderer);
    }
    this.visible = true;
    for (let i = 0; i < this.ignoreObjects.length; i++) this.ignoreObjects[i].visible = true;
  };

  updateCameraScene(e: Camera, t: Scene) {
    this.sceneCamera = e as PerspectiveCamera;
    this.camera = e.clone() as PerspectiveCamera;
    this.scene = t;
  }

  clearIgnoreObjects() {
    this.ignoreObjects = [];
  }

  destroy() {
    this.renderTarget.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.mipmapper.dispose();
    n.off(o.events.RESIZE, this.onResize);
  }
}
