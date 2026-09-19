/* eslint-disable @typescript-eslint/no-explicit-any */
// CSS3DObject + CSS3DRenderer. three r143 examples, modified:
// the renderer emits "cssrenderer:cacheUpdated" on the event bus whenever the perspective changes.
import { Camera, Matrix4, Object3D, Quaternion, Scene, Vector3 } from "three";
import E from "./event-bus";

const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();

export class CSS3DObject extends Object3D {
  isCSS3DObject = true;
  element: HTMLElement;

  constructor(element: HTMLElement = document.createElement("div")) {
    super();
    this.element = element;
    this.element.style.position = "absolute";
    this.element.style.pointerEvents = "auto";
    this.element.style.userSelect = "none";
    this.element.setAttribute("draggable", "false");
    this.addEventListener("removed", function (this: CSS3DObject) {
      this.traverse(function (object: any) {
        if (object.element instanceof Element && object.element.parentNode !== null)
          object.element.parentNode.removeChild(object.element);
      });
    });
  }

  copy(source: this, recursive?: boolean) {
    super.copy(source, recursive);
    this.element = source.element.cloneNode(true) as HTMLElement;
    return this;
  }
}

export class CSS3DSprite extends CSS3DObject {
  isCSS3DSprite = true;
  rotation2D = 0;

  copy(source: this, recursive?: boolean) {
    super.copy(source, recursive);
    this.rotation2D = source.rotation2D;
    return this;
  }
}

const _matrix = new Matrix4();
const _matrix2 = new Matrix4();

export class CSS3DRenderer {
  domElement: HTMLElement;
  cache: { camera: { fov: number; style: string }; objects: WeakMap<Object3D, { style: string }> };
  getSize: () => { width: number; height: number };
  render: (scene: Scene, camera: Camera) => void;
  setSize: (width: number, height: number) => void;

  constructor(parameters: { element?: HTMLElement } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const _this = this;
    let _width: number, _height: number, _widthHalf: number, _heightHalf: number;

    this.cache = { camera: { fov: 0, style: "" }, objects: new WeakMap() };

    const domElement = parameters.element !== undefined ? parameters.element : document.createElement("div");
    domElement.style.overflow = "hidden";
    this.domElement = domElement;

    const cameraElement = document.createElement("div");
    cameraElement.style.transformStyle = "preserve-3d";
    cameraElement.style.pointerEvents = "none";
    domElement.appendChild(cameraElement);

    this.getSize = function () {
      return { width: _width, height: _height };
    };

    this.render = function (scene: any, camera: any) {
      const fov = camera.projectionMatrix.elements[5] * _heightHalf;
      let tx = 0,
        ty = 0;

      if (_this.cache.camera.fov !== fov) {
        domElement.style.perspective = camera.isPerspectiveCamera ? fov + "px" : "";
        _this.cache.camera.fov = fov;
        E.emit("cssrenderer:cacheUpdated");
      }

      if (scene.autoUpdate === true) scene.updateMatrixWorld();
      if (camera.parent === null) camera.updateMatrixWorld();

      if (camera.isOrthographicCamera) {
        tx = -(camera.right + camera.left) / 2;
        ty = (camera.top + camera.bottom) / 2;
      }

      const cameraCSSMatrix = camera.isOrthographicCamera
        ? "scale(" +
          fov +
          ")" +
          "translate(" +
          epsilon(tx) +
          "px," +
          epsilon(ty) +
          "px)" +
          getCameraCSSMatrix(camera.matrixWorldInverse)
        : "translateZ(" + fov + "px)" + getCameraCSSMatrix(camera.matrixWorldInverse);

      const style = cameraCSSMatrix + "translate(" + _widthHalf + "px," + _heightHalf + "px)";

      if (_this.cache.camera.style !== style) {
        cameraElement.style.transform = style;
        _this.cache.camera.style = style;
      }

      renderObject(scene, scene, camera, cameraCSSMatrix);
    };

    this.setSize = function (width: number, height: number) {
      _width = width;
      _height = height;
      _widthHalf = _width / 2;
      _heightHalf = _height / 2;
      domElement.style.width = width + "px";
      domElement.style.height = height + "px";
      cameraElement.style.width = width + "px";
      cameraElement.style.height = height + "px";
    };

    function epsilon(value: number) {
      return Math.abs(value) < 1e-10 ? 0 : value;
    }

    function getCameraCSSMatrix(matrix: Matrix4) {
      const e = matrix.elements;
      return (
        "matrix3d(" +
        epsilon(e[0]) + "," + epsilon(-e[1]) + "," + epsilon(e[2]) + "," + epsilon(e[3]) + "," +
        epsilon(e[4]) + "," + epsilon(-e[5]) + "," + epsilon(e[6]) + "," + epsilon(e[7]) + "," +
        epsilon(e[8]) + "," + epsilon(-e[9]) + "," + epsilon(e[10]) + "," + epsilon(e[11]) + "," +
        epsilon(e[12]) + "," + epsilon(-e[13]) + "," + epsilon(e[14]) + "," + epsilon(e[15]) +
        ")"
      );
    }

    function getObjectCSSMatrix(matrix: Matrix4) {
      const e = matrix.elements;
      const m =
        "matrix3d(" +
        epsilon(e[0]) + "," + epsilon(e[1]) + "," + epsilon(e[2]) + "," + epsilon(e[3]) + "," +
        epsilon(-e[4]) + "," + epsilon(-e[5]) + "," + epsilon(-e[6]) + "," + epsilon(-e[7]) + "," +
        epsilon(e[8]) + "," + epsilon(e[9]) + "," + epsilon(e[10]) + "," + epsilon(e[11]) + "," +
        epsilon(e[12]) + "," + epsilon(e[13]) + "," + epsilon(e[14]) + "," + epsilon(e[15]) +
        ")";
      return "translate(-50%,-50%)" + m;
    }

    function renderObject(object: any, scene: any, camera: any, cameraCSSMatrix: string) {
      if (object.isCSS3DObject) {
        const visible = object.visible === true && object.layers.test(camera.layers) === true;
        object.element.style.display = visible === true ? "" : "none";

        if (visible === true) {
          object.onBeforeRender(_this, scene, camera);
          let style: string;

          if (object.isCSS3DSprite) {
            _matrix.copy(camera.matrixWorldInverse);
            _matrix.transpose();
            if (object.rotation2D !== 0) _matrix.multiply(_matrix2.makeRotationZ(object.rotation2D));
            object.matrixWorld.decompose(_position, _quaternion, _scale);
            _matrix.setPosition(_position);
            _matrix.scale(_scale);
            _matrix.elements[3] = 0;
            _matrix.elements[7] = 0;
            _matrix.elements[11] = 0;
            _matrix.elements[15] = 1;
            style = getObjectCSSMatrix(_matrix);
          } else {
            style = getObjectCSSMatrix(object.matrixWorld);
          }

          const element = object.element;
          const cachedObject = _this.cache.objects.get(object);

          if (cachedObject === undefined || cachedObject.style !== style) {
            element.style.transform = style;
            _this.cache.objects.set(object, { style });
          }

          if (element.parentNode !== cameraElement) cameraElement.appendChild(element);

          object.onAfterRender(_this, scene, camera);
        }
      }

      for (let i = 0, l = object.children.length; i < l; i++)
        renderObject(object.children[i], scene, camera, cameraCSSMatrix);
    }
  }
}
