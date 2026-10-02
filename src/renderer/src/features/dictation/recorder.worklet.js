// The microphone's sound on the audio thread (milestone 4, dictation): an AudioWorklet, in place of the
// ScriptProcessor Poor-Mans-Holodeck's src/lib/dictate.ts used. It passes the samples on in small
// batches, each with its loudest sample and its average level, and keeps nothing itself.
// Plain JavaScript: the build copies it as a file of its own, as it is (mic.ts imports its address with ?url&no-inline).

/** Samples in a batch: 1024 at 16 kHz is 64 ms, about 16 batches a second. */
const BATCH = 1024

class DictationRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.batch = new Float32Array(BATCH)
    this.n = 0
    this.peak = 0
    this.sum = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const x = channel[i]
        this.batch[this.n++] = x
        const a = x < 0 ? -x : x
        if (a > this.peak) this.peak = a
        this.sum += x * x
        if (this.n === BATCH) this.send()
      }
    }
    return true
  }

  send() {
    const samples = this.batch
    this.port.postMessage({ samples, peak: this.peak, rms: Math.sqrt(this.sum / this.n) }, [samples.buffer])
    this.batch = new Float32Array(BATCH)
    this.n = 0
    this.peak = 0
    this.sum = 0
  }
}

registerProcessor('aiwrite-dictation', DictationRecorder)
