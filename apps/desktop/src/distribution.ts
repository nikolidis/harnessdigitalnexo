/**
 * Digital Nexo distribution switches for the Desktop shell.
 *
 * This distribution ships without DeepSeek's services. There is no DeepSeek account: the native welcome
 * window that signs in to one never opens, the workspace opens directly, and the Web client shows its own
 * first-run notice and model setup, as `dsh web` does. There is no update service: the shell neither
 * checks for updates nor offers to, and the Web client receives no update bridge.
 */

/** Product choices the shell reads at run time; tests substitute the original release's choices. */
export interface DesktopDistribution {
  /** Name shown in the About panel; menus, dialogs, and the tray take theirs from the locale dictionaries. */
  readonly productName: string
  /** Whether the shell signs in to a DeepSeek account and gates the workspace behind the welcome window. */
  readonly accountSignIn: boolean
  /** Whether the shell checks, downloads, and installs updates. */
  readonly updates: boolean
}

/** The choices this build ships with. */
export const DESKTOP_DISTRIBUTION: DesktopDistribution = {
  productName: 'Digital Nexo',
  accountSignIn: false,
  updates: false,
}
