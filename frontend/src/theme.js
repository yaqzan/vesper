import { createTheme } from '@mantine/core'

// Vesper's palette: warm gold against near-black. "A warm room at dusk."
//
// `gold` is the primary accent (Vesper = the evening star). `dark` overrides
// Mantine's default dark shades so surfaces match the spec exactly:
//   background #0a0a0a · surface #161616 · elevated #1e1e1e.
export const theme = createTheme({
  primaryColor: 'gold',
  primaryShade: 3,
  colors: {
    gold: [
      '#fef9ec',
      '#faefd0',
      '#f2d98a',
      '#c9a84c',
      '#a8852e',
      '#876414',
      '#6a4d0e',
      '#523b0a',
      '#3c2b07',
      '#281c04',
    ],
    dark: [
      '#e8e8e8',
      '#b0b0b0',
      '#888888',
      '#555555',
      '#383838',
      '#2a2a2a',
      '#1e1e1e',
      '#161616',
      '#0f0f0f',
      '#0a0a0a',
    ],
  },
  defaultRadius: 'md',
  fontFamily: 'Plus Jakarta Sans Variable, system-ui, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  headings: {
    fontFamily: 'Plus Jakarta Sans Variable, system-ui, sans-serif',
    fontWeight: '600',
  },
  other: {
    serif: 'Lora, Georgia, serif',
  },
})
