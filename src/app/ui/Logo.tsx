// The Drivo logo, used as provided (public/brand/*.png): never redrawn or recoloured in code.
// `tone` picks the white (for the blue sidebar / dark surfaces) or blue (light surfaces, print) file.
export function Logo({ tone, mark = false, width, className = '' }: { tone: 'white' | 'blue'; mark?: boolean; width: number; className?: string }) {
  const src = `/brand/${mark ? 'mark' : 'logo'}-${tone}.png`;
  // The full logo is 874x196; the mark is square.
  const height = mark ? width : Math.round((width * 196) / 874);
  return <img src={src} alt="Drivo" width={width} height={height} className={`select-none ${className}`} draggable={false} />;
}
