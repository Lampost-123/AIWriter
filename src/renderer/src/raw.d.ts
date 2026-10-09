// Files the bundler (Vite) hands over as their text: `import text from './file.md?raw'`.
declare module '*?raw' {
  const text: string
  export default text
}
