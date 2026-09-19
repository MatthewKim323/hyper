// Area averaging preserves timing across render blocks, including 44.1 kHz input.
export class PCMResampler {
  constructor(inputRate, outputRate = 16000, frameSize = 1280) {
    if (!(inputRate > 0 && outputRate > 0 && frameSize > 0)) throw new Error('Invalid PCM format');
    this.ratio = inputRate / outputRate;
    this.remaining = this.ratio;
    this.sum = 0;
    this.frame = new ArrayBuffer(frameSize * 2);
    this.view = new DataView(this.frame);
    this.frameSize = frameSize;
    this.position = 0;
  }

  push(channels) {
    const frames = [];
    if (!channels.length || !channels[0]?.length) return frames;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;
      for (const channel of channels) sample += Number.isFinite(channel[index]) ? channel[index] : 0;
      sample = Math.max(-1, Math.min(1, sample / channels.length));
      let available = 1;
      while (available > 1e-9) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining < 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.view.setInt16(this.position++ * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.remaining = this.ratio;
          this.sum = 0;
          if (this.position === this.frameSize) {
            frames.push(this.frame);
            this.frame = new ArrayBuffer(this.frameSize * 2);
            this.view = new DataView(this.frame);
            this.position = 0;
          }
        }
      }
    }
    return frames;
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  class OnboardingPCMProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.resampler = new PCMResampler(sampleRate);
    }

    process(inputs) {
      for (const frame of this.resampler.push(inputs[0] || [])) this.port.postMessage(frame, [frame]);
      // Outputs stay silent; only the captured PCM travels to the session socket.
      return true;
    }
  }
  registerProcessor('hyper-onboarding-pcm', OnboardingPCMProcessor);
}
