// Concrete sRGB values keep exported SVGs independent of CSS variables.
export const PAL = {
  accent: "#2456a6",
  success: "#13735b",
  warning: "#a15114",
  text: "#182338",
  textMuted: "#526078",
  textFaint: "#69778c",
  bg: "#f6f7fa",
  surface: "#ffffff",
  navyBg: "#f6f7fa",
  navyBubbleAI: "#ffffff",
  border: "#c9d1df",
  borderSoft: "#dce2eb",
  evPurple: "#7851a9",
  evTeal: "#087e8b",
  evOrange: "#b95815",
  evGreen: "#247d45",
};
export const RADIUS = { sm: 6, md: 10, lg: 14 };
export const EASE = "cubic-bezier(.2,.8,.2,1)";
export function alpha(color, opacity) {
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color))
    throw new Error("Expected resolved hex color");
  const existing = color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1;
  return `${color.slice(0, 7)}${Math.round(
    existing * Math.max(0, Math.min(1, opacity)) * 255,
  )
    .toString(16)
    .padStart(2, "0")}`;
}
