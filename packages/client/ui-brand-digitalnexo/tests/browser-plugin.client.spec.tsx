// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { DigitalNexoBrandMark, DigitalNexoBrandName, DigitalNexoHeroMark, WORDMARK_HEIGHT } from '../src/client/Brand.tsx'
import { MONOGRAM, TILE_EDGE, WORDMARK } from '../src/client/artwork.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
})

const SIDEBAR_HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

const ALL_HOLES = [...SIDEBAR_HOLES, HERO_HOLE] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(ALL_HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('Digital Nexo browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills the sidebar and hero slots whatever the build profile', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of ALL_HOLES) expect(subject.slots.entries(hole)).toHaveLength(1)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of ALL_HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of ALL_HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of ALL_HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('renders a square tile at both requested mark sizes', () => {
    const mark = render(<DigitalNexoBrandMark size={24} />)
    const svg = mark.container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('height')).toBe('24')
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${TILE_EDGE} ${TILE_EDGE}`)
    expect(svg?.getAttribute('data-brand')).toBe('digitalnexo')
    mark.unmount()

    const hero = render(<DigitalNexoHeroMark size={34} />)
    expect(hero.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    expect(hero.container.querySelector('svg')?.getAttribute('height')).toBe('34')
  })

  it('renders the wordmark at the brand-row height with its native proportions', () => {
    const name = render(<DigitalNexoBrandName />)
    const svg = name.container.querySelector('svg')
    expect(svg?.getAttribute('height')).toBe(String(WORDMARK_HEIGHT))
    expect(Number(svg?.getAttribute('width'))).toBeCloseTo((WORDMARK_HEIGHT * WORDMARK.width) / WORDMARK.height, 5)
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${WORDMARK.width} ${WORDMARK.height}`)
    // Lettering and the accent period are separate paths so each takes its own fill.
    expect(svg?.querySelectorAll('path')).toHaveLength(2)
  })

  it('keeps the lettering and the accent period as distinct artwork', () => {
    for (const artwork of [WORDMARK, MONOGRAM]) {
      expect(artwork.letters.startsWith('M')).toBe(true)
      expect(artwork.dot.startsWith('M')).toBe(true)
      expect(artwork.width).toBeGreaterThan(0)
      expect(artwork.height).toBeGreaterThan(0)
    }
  })
})
