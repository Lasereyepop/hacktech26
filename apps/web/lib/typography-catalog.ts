export const FONT_PRESETS = [
  {
    id: "tasteSans",
    label: "Taste Sans",
    value:
      '"Avenir Next", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  },
  {
    id: "productSans",
    label: "Product Sans",
    value:
      '"SF Pro Display", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  },
  {
    id: "neoGrotesk",
    label: "Neo Grotesk",
    value:
      '"Helvetica Neue", Arial, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
  },
  {
    id: "humanist",
    label: "Humanist",
    value: '"Gill Sans", "Trebuchet MS", "Avenir Next", "Segoe UI", sans-serif',
  },
  {
    id: "softGeometric",
    label: "Soft Geometric",
    value:
      '"Avenir Next", "Nunito Sans", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  },
  {
    id: "roundedSystem",
    label: "Rounded System",
    value:
      'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Avenir Next", system-ui, sans-serif',
  },
  {
    id: "editorialSerif",
    label: "Editorial Serif",
    value: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    id: "luxurySerif",
    label: "Luxury Serif",
    value:
      '"Didot", "Bodoni 72", "Bodoni MT", "Iowan Old Style", Georgia, serif',
  },
  {
    id: "newsSerif",
    label: "News Serif",
    value:
      'Charter, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  },
  {
    id: "classicalBook",
    label: "Classical Book",
    value: 'Garamond, "Hoefler Text", Baskerville, Georgia, serif',
  },
  {
    id: "condensedPoster",
    label: "Condensed Poster",
    value:
      '"Arial Narrow", "Avenir Next Condensed", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: "displayCondensed",
    label: "Display Condensed",
    value:
      'Impact, Haettenschweiler, "Arial Narrow Bold", "Avenir Next Condensed", sans-serif',
  },
  {
    id: "monoUi",
    label: "Mono UI",
    value:
      '"SF Mono", "Cascadia Code", "Roboto Mono", Consolas, "Liberation Mono", monospace',
  },
  {
    id: "technicalMono",
    label: "Technical Mono",
    value:
      '"IBM Plex Mono", "SF Mono", "Cascadia Code", "Roboto Mono", Consolas, monospace',
  },
  {
    id: "casualHumanist",
    label: "Casual Humanist",
    value:
      '"Trebuchet MS", "Gill Sans", "Avenir Next", "Segoe UI", system-ui, sans-serif',
  },
] as const;

export type FontPresetId = (typeof FONT_PRESETS)[number]["id"];

export const DEFAULT_CANVAS_FONT = FONT_PRESETS[0].value;

export const FONT_PRESET_LABELS = FONT_PRESETS.map((font) => font.label);
