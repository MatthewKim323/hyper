// FullScreenQuad.
import { Material, Mesh, OrthographicCamera, PlaneGeometry, WebGLRenderer } from "three";

export class FullScreenQuad {
  private _mesh: Mesh<PlaneGeometry, Material>;
  private _camera: OrthographicCamera;

  get camera() {
    return this._camera;
  }

  get material() {
    return this._mesh.material;
  }

  set material(m: Material) {
    this._mesh.material = m;
  }

  constructor(material: Material) {
    this._camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._mesh = new Mesh(new PlaneGeometry(2, 2), material);
  }

  dispose() {
    this._mesh.geometry.dispose();
  }

  render(renderer: WebGLRenderer) {
    renderer.render(this._mesh, this._camera);
  }
}

export default FullScreenQuad;
