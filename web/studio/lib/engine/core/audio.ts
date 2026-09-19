/* eslint-disable @typescript-eslint/no-explicit-any */
// Audio. Howler sprite, starts globally muted.
// Keys are "<sprite>.<name>", e.g. store.Audio.play({ key: "audio.menu_swoosh" }).
import { Howl, Howler } from "howler";
import E from "./event-bus";
import { store } from "./store";
import { assetUrl } from "./asset-url";

// [offset ms, duration ms, loop?]
export const audioSprites: Record<string, Record<string, [number, number, boolean?]>> = {
  audio: {
    backing: [0, 30747.16553287982, true],
    click: [31200, 500],
    contact_swoosh: [32400, 4500],
    hover: [37600, 500],
    menu_close: [38800.00000000001, 1000],
    menu_swoosh: [40000.00000000001, 1071.020408163264],
    navlinks_hover: [42200, 1567.3469387755076],
    new_water_projects: [44400, 2500],
    ratchet: [47600, 61.609977324259546],
    world_static: [48800, 5294.8526077097495],
    "world-intro": [54999.99999999999, 12800.000000000004],
    "world-loop": [68200, 12799.999999999996, true],
  },
};

function splitKey(key: string) {
  return key.split(".");
}

export interface PlayOptions {
  key: string;
  fade?: { from: number; to: number; duration: number };
  volume?: number;
  speed?: number;
  isInteraction?: boolean;
  callback?: () => void;
}

export class Audio {
  sprites: Record<string, Howl | null> = { audio: null };
  html5 = false;
  activeSounds: Record<string, number> = {};
  activeNarration: any = null;

  constructor() {
    Howler.mute(true);
    const ua = navigator ? navigator.userAgent : "";
    const isCatalina = ua.match(/Mac OS X 10_15/);
    const isSafari = ua.indexOf("Safari") !== -1 && ua.indexOf("Chrome") === -1;
    const version = ua.match(/Version\/(.*?) /);
    if (isCatalina && isSafari && version && parseInt(version[1], 10) === 15) this.html5 = true;
    for (const name in this.sprites) this.loadSprite(name);
    this.addDomEvents();
    document.addEventListener("visibilitychange", () => {
      if (store.PageLoader && store.PageLoader.hidden) {
        if (document.hidden) Howler.mute(true);
        else if (!store.audioMuted) Howler.mute(false);
      }
    });
  }

  loadSprite(name: string) {
    store.AssetLoader!.add(
      new Promise<void>((resolve, reject) => {
        this.sprites[name] = new Howl({
          src: [assetUrl(`audio/${name}.webm`), assetUrl(`audio/${name}.mp3`)],
          sprite: audioSprites[name] as any,
          html5: this.html5,
          onload: () => resolve(),
          onloaderror: (id, err) => {
            console.error(id, err, name);
            reject();
          },
        });
      }),
    );
  }

  unloadSprite(name: string) {
    this.sprites[name]!.unload();
  }

  addDomEvents() {
    E.delegate("mouseenter", "[data-audio-enter]", (e: any) => {
      if (!document.body.classList.contains("is-touch"))
        this.play({ key: e.currentTarget.dataset.audioEnter, isInteraction: true });
    });
    E.delegate("mouseleave", "[data-audio-leave]", (e: any) => {
      if (!document.body.classList.contains("is-touch"))
        this.play({ key: e.currentTarget.dataset.audioLeave, isInteraction: true });
    });
    E.delegate("click", "[data-audio-click]", (e: any) => {
      this.play({ key: e.currentTarget.dataset.audioClick, isInteraction: true });
    });
    E.delegate("click", "[data-audio-mute]", (e: any) => {
      const k = e.currentTarget.dataset.audioMute;
      if (k && k !== "") this.mute(k, true);
      else this.muteAll(true);
    });
    E.delegate("click", "[data-audio-unmute]", (e: any) => {
      const k = e.currentTarget.dataset.audioUnmute;
      if (k && k !== "") this.mute(k, false);
      else this.muteAll(false);
    });
    E.delegate("click", "[data-audio-stop]", (e: any) => {
      const k = e.currentTarget.dataset.audioStop;
      if (k && k !== "") this.stop(k);
      else this.stopAll();
    });
  }

  play({ key, fade, volume, speed, isInteraction, callback }: PlayOptions) {
    const [spriteName, sound] = splitKey(key);
    const sprite = this.sprites[spriteName] as any;
    if (!sprite) {
      console.error(`Sound not found - ${spriteName}.${sound}`);
      return;
    }
    const loop = audioSprites[spriteName][sound][2];
    if (!(loop && this.activeSounds[key])) this.activeSounds[key] = sprite.play(sound, false);
    if (this.activeSounds[key]) {
      if (fade) sprite.fade(fade.from, fade.to, 1e3 * fade.duration, this.activeSounds[key]);
      if (volume) sprite.volume(volume, this.activeSounds[key]);
      if (speed && !this.html5)
        for (let t = 0; t < sprite._sounds.length; t++)
          if (sprite._sounds[t]._id === this.activeSounds[key] && sprite._sounds[t]._node.bufferSource.playbackRate)
            sprite._sounds[t]._node.bufferSource.playbackRate.value = speed;
    }
    if (isInteraction && !loop) delete this.activeSounds[key];
    if (!isInteraction) {
      sprite.once(
        "stop",
        () => {
          if (this.activeSounds[key]) delete this.activeSounds[key];
        },
        this.activeSounds[key],
      );
      if (!loop)
        sprite.once(
          "end",
          () => {
            if (this.activeSounds[key]) delete this.activeSounds[key];
            if (callback) callback();
          },
          this.activeSounds[key],
        );
    }
  }

  isPlaying(key: string) {
    return !!this.activeSounds[key];
  }

  lerpSpeed(key: string, target: number, duration: number) {
    const [spriteName, sound] = splitKey(key);
    const sprite = this.sprites[spriteName] as any;
    if (sprite._sprite[sound])
      for (let i = 0; i < sprite._sounds.length; i++) {
        const snd = sprite._sounds[i];
        if (snd._sprite === sound) {
          const start = snd?._node?.bufferSource?.playbackRate.value;
          if (!start) return;
          const step = (start > target ? start - target : target - start) / (duration / 50);
          const interval = setInterval(() => {
            const cur = snd?._node?.bufferSource?.playbackRate?.value;
            if (cur) {
              if (start > target) {
                if (cur <= target) return void window.clearInterval(interval);
                snd._node.bufferSource.playbackRate.value = cur - step;
              } else {
                if (cur >= target) return void window.clearInterval(interval);
                snd._node.bufferSource.playbackRate.value = cur + step;
              }
            } else window.clearInterval(interval);
          }, 50);
          break;
        }
      }
  }

  filterTo({
    key,
    type,
    duration,
    from = {},
    to = {},
  }: {
    key: string;
    type: BiquadFilterType;
    duration: number;
    from?: { frequency?: number; q?: number; gain?: number; detune?: number };
    to?: { frequency?: number; q?: number; gain?: number; detune?: number };
  }) {
    if (this.html5) {
      this.fadeToStop({ key, duration: 1 });
      return;
    }
    const [spriteName, sound] = splitKey(key);
    const a = Object.assign({ frequency: 350, q: 1, gain: 0, detune: 0 }, from);
    const l = Object.assign({ frequency: 350, q: 1, gain: 0, detune: 0 }, to);
    const sprite = this.sprites[spriteName] as any;
    if (sprite._sprite[sound])
      for (let i = 0; i < sprite._sounds.length; i++) {
        const s = sprite._sounds[i];
        if (s._sprite === sound) {
          // No buffer source until the context is unlocked by a user gesture.
          if (!s._node?.bufferSource) break;
          const filter: any = (Howler as any).ctx.createBiquadFilter();
          filter.type = type;
          filter.frequency.value = a.frequency;
          filter.Q.value = a.q;
          filter.gain.value = a.gain;
          filter.detune.value = a.detune;
          s._node.bufferSource.disconnect();
          if (s.filter) s.filter.disconnect();
          s._node.bufferSource.connect(filter);
          s.filter = filter;
          filter.connect(s._node);
          filter.frequency.exponentialRampToValueAtTime(l.frequency, s._node.context.currentTime + duration / 1e3);
          if (a.detune !== l.detune)
            filter.detune.exponentialRampToValueAtTime(l.detune, s._node.context.currentTime + duration / 1e3);
          // Update the filter quality only when it changes.
          if (a.q !== l.q) filter.q.exponentialRampToValueAtTime(l.q, s._node.context.currentTime + duration / 1e3);
          break;
        }
      }
  }

  fadeTo({ key, to, duration, callback }: { key?: string; to: number; duration: number; callback?: () => void }) {
    const done = () => {
      if (callback) callback();
    };
    if (key) {
      const [spriteName] = splitKey(key);
      const sprite = this.sprites[spriteName] as any;
      if (this.activeSounds[key]) {
        sprite.once("fade", done, this.activeSounds[key]);
        sprite.fade(sprite.volume(this.activeSounds[key]), to, 1e3 * duration, this.activeSounds[key]);
      }
    } else {
      let bound: boolean | null = null;
      for (const k in this.activeSounds) {
        const id = this.activeSounds[k];
        const [spriteName] = splitKey(k);
        const sprite = this.sprites[spriteName] as any;
        if (!bound) {
          sprite.once("fade", done, id);
          bound = true;
        }
        sprite.fade(sprite.volume(id), to, 1e3 * duration, id);
      }
    }
  }

  fadeToStop({ key, to = 0, duration }: { key: string; to?: number; duration: number }) {
    this.fadeTo({ key, to, duration, callback: () => this.stop(key) });
  }

  stop(key: string) {
    if (this.activeSounds[key]) {
      const [spriteName] = splitKey(key);
      (this.sprites[spriteName] as any).stop(this.activeSounds[key], false);
      delete this.activeSounds[key];
    }
  }

  stopAll() {
    Howler.stop();
    this.activeSounds = {};
  }

  setVolume({ key, volume }: { key: string; volume: number }) {
    if (this.activeSounds[key]) {
      const [spriteName] = splitKey(key);
      this.sprites[spriteName]!.volume(volume, this.activeSounds[key]);
    }
  }

  mute(key: string, muted: boolean) {
    if (this.activeSounds[key]) {
      const [spriteName] = splitKey(key);
      this.sprites[spriteName]!.mute(muted, this.activeSounds[key]);
    }
  }

  muteAll(muted: boolean) {
    Howler.mute(muted);
    E.emit("AudioMute", muted);
  }

  duration(key: string) {
    const [spriteName, sound] = splitKey(key);
    const sprite = this.sprites[spriteName] as any;
    return sprite._sprite[sound] ? sprite._sprite[sound][1] : null;
  }

  lerp(a: number, b: number, t: number) {
    t = t < 0 ? 0 : t;
    t = t > 1 ? 1 : t;
    return a + (b - a) * t;
  }
}

export default Audio;
