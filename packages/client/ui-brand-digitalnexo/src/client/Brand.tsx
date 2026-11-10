import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { MONOGRAM, TILE_EDGE, TILE_MONOGRAM, TILE_RADIUS, WORDMARK } from './artwork.ts'
import css from './Brand.module.css'

/** Rendered height of the sidebar wordmark in px; the brand row is 24px tall. */
export const WORDMARK_HEIGHT = 12

/**
 * Render the square Digital Nexo tile at the requested edge.
 * @param props.size - square edge in px.
 * @returns the tile svg (aria-hidden decorative brand art).
 */
function BrandTile({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      className={css.mark}
      viewBox={`0 0 ${TILE_EDGE} ${TILE_EDGE}`}
      fill="none"
      aria-hidden="true"
      data-brand="digitalnexo"
    >
      <rect className={css.tile} width={TILE_EDGE} height={TILE_EDGE} rx={TILE_RADIUS} />
      <g transform={`translate(${TILE_MONOGRAM.x} ${TILE_MONOGRAM.y}) scale(${TILE_MONOGRAM.scale})`}>
        <path className={css.tileGlyph} d={MONOGRAM.letters} />
        <path className={css.tileAccent} d={MONOGRAM.dot} />
      </g>
    </svg>
  )
}

/**
 * Render the Digital Nexo mark for the sidebar brand row and the collapsed rail.
 * @param props - Host-supplied mark presentation.
 * @returns the Digital Nexo tile.
 */
export function DigitalNexoBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <BrandTile size={size} />
}

/**
 * Render the "DIGITALNEXO." wordmark beside the sidebar mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function DigitalNexoBrandName() {
  return (
    <svg
      width={(WORDMARK_HEIGHT * WORDMARK.width) / WORDMARK.height}
      height={WORDMARK_HEIGHT}
      className={css.name}
      viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`}
      fill="none"
      aria-hidden="true"
      data-brand="digitalnexo"
    >
      <path className={css.ink} d={WORDMARK.letters} />
      <path className={css.accent} d={WORDMARK.dot} />
    </svg>
  )
}

/**
 * Render the Digital Nexo mark before the blank-session headline. The host's
 * mark class carries the fish swim animation, so this occupant keeps its own
 * static presentation instead of adopting it.
 * @param props - Host-supplied mark presentation.
 * @returns the Digital Nexo tile.
 */
export function DigitalNexoHeroMark({ size }: HeroBrandMarkOwnerProps) {
  return <BrandTile size={size} />
}
