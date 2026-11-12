/** Stage local-branded DSH packages for unsigned Desktop builds without a publication record. */

import { globSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import * as yaml from 'js-yaml'
import {
  readClientBuildRecord,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
} from '../../../scripts/client-build-environment.ts'
import { releaseFamily } from '../../../scripts/release/families.ts'
import { packFamilyMembers, parsePackConcurrency } from '../../../scripts/release/pack.ts'
import { runConcurrent } from '../../../scripts/release/process.ts'
import { pnpmInvocation } from '../../../scripts/pnpm-invocation.ts'

/** Scope of the Digital Nexo distribution's own workspace packages, which no release family publishes. */
const DISTRIBUTION_SCOPE = '@digitalnexo/'

/**
 * Directories of the distribution's own workspace packages, in name order.
 * @param root - repository root holding `pnpm-workspace.yaml`.
 * @returns package directories relative to the root.
 */
function distributionPackageDirectories(root: string): string[] {
  const workspace = yaml.load(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] }
  return globSync(workspace.packages.map(pattern => `${pattern}/package.json`), { cwd: root })
    .map(path => ({ path, name: (JSON.parse(readFileSync(join(root, path), 'utf8')) as { name?: string }).name ?? '' }))
    .filter(entry => entry.name.startsWith(DISTRIBUTION_SCOPE))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(entry => dirname(entry.path))
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, concurrency: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.out === undefined) throw new Error('desktop local pack: --out must name the package staging directory')
  const concurrency = parsePackConcurrency(values.concurrency)
  const root = process.cwd()
  const environment = resolveClientBuildEnvironment(repositoryClientBuildEnvironment(root), 'local')
  readClientBuildRecord(root, environment)
  const destination = resolve(root, values.out)
  const packed = await packFamilyMembers(root, releaseFamily('dsh'), destination, concurrency)
  // The dsh family requires @deepseek-ai names and skips private packages; the Desktop closure still needs ours.
  const own = distributionPackageDirectories(root)
  for (const directory of own) {
    const invocation = pnpmInvocation(['--dir', directory, 'pack', '--pack-destination', destination])
    await runConcurrent(invocation.command, invocation.args)
  }
  console.log(`desktop local pack: ${String(packed.length + own.length)} tarball(s) in ${destination}`)
}

await main()
