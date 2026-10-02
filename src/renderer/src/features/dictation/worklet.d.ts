// The microphone's AudioWorklet (recorder.worklet.js), imported by mic.ts as the address of a file the
// build copies as it is.
declare module '*recorder.worklet.js?url&no-inline' {
  const url: string
  export default url
}
