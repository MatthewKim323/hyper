// HandTracker: webcam into MediaPipe Hand Landmarker, one result per new camera frame.
import type { HandLandmarker, Landmark, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type HandFrame = {
  /** Timestamp of the frame in ms (performance clock). */
  t: number;
  /** 21 landmarks, x and y normalized to the frame, not mirrored. */
  landmarks: NormalizedLandmark[];
  /** 21 landmarks in meters, centered on the hand. */
  world: Landmark[];
  /** Frame width divided by height. */
  aspect: number;
};

const WASM = "/mediapipe/wasm";
const MODEL = "/mediapipe/hand_landmarker.task";

export class HandTracker {
  video: HTMLVideoElement;
  /** Frame rate the camera actually agreed to. */
  fps = 0;
  private stream: MediaStream | null = null;
  private hands: HandLandmarker | null = null;
  private running = false;
  private lastT = -1;
  private lastMediaTime = -1;

  constructor(
    private onFrame: (frame: HandFrame) => void,
    private onLost: () => void,
  ) {
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
  }

  async start() {
    // Camera and model load in parallel; the model is the slower of the two on first use.
    const video = { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" };
    // A camera that cannot promise 24 fps (cheap webcams, low light modes) still beats no hand cursor.
    const camera = navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, frameRate: { ideal: 120, min: 24 } } })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException) || error.name !== "OverconstrainedError") throw error;
        return navigator.mediaDevices.getUserMedia({ audio: false, video: { ...video, frameRate: { ideal: 60 } } });
      });
    const model = (async () => {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "VIDEO" as const,
        // One hand: a second slot makes the palm detector run every frame while it stays empty.
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        return await HandLandmarker.createFromOptions(fileset, options("GPU"));
      } catch {
        return await HandLandmarker.createFromOptions(fileset, options("CPU"));
      }
    })();
    try {
      [this.stream, this.hands] = await Promise.all([camera, model]);
    } catch (error) {
      void camera.then((s) => s.getTracks().forEach((t) => t.stop())).catch(() => {});
      void model.then((m) => m.close()).catch(() => {});
      throw error;
    }
    this.fps = this.stream.getVideoTracks()[0]?.getSettings().frameRate ?? 0;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.schedule();
  }

  private schedule() {
    if (!this.running) return;
    if ("requestVideoFrameCallback" in this.video) this.video.requestVideoFrameCallback((now, meta) => this.detect(now, meta.mediaTime));
    else requestAnimationFrame((now) => this.detect(now, (this.video as HTMLVideoElement).currentTime));
  }

  private detect(now: number, mediaTime: number) {
    if (!this.running || !this.hands) return;
    // Skip repeats of a frame already seen, and keep timestamps strictly increasing for the tracker.
    if (mediaTime !== this.lastMediaTime && now > this.lastT && this.video.videoWidth > 0) {
      this.lastMediaTime = mediaTime;
      this.lastT = now;
      const result = this.hands.detectForVideo(this.video, now);
      if (result.landmarks.length && result.worldLandmarks.length)
        this.onFrame({
          t: now,
          landmarks: result.landmarks[0],
          world: result.worldLandmarks[0],
          aspect: this.video.videoWidth / this.video.videoHeight,
        });
      else this.onLost();
    }
    this.schedule();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.hands?.close();
    this.hands = null;
  }
}
