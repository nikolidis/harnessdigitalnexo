/**
 * Digital Nexo distribution switches for the Desktop shell.
 *
 * This distribution ships without DeepSeek's services. There is no DeepSeek account: the native welcome
 * window that signs in to one never opens, the workspace opens directly, and the Web client shows its own
 * first-run notice and model setup, as `dsh web` does. There is no update service: the shell neither
 * checks for updates nor offers to, and the Web client receives no update bridge.
 */
export const DESKTOP_DISTRIBUTION = {
  /** Name shown in the About panel; menus, dialogs, and the tray take theirs from the locale dictionaries. */
  productName: 'Digital Nexo',
  /** Whether the shell signs in to a DeepSeek account and gates the workspace behind the welcome window. */
  accountSignIn: false,
  /** Whether the shell checks, downloads, and installs updates. */
  updates: false,
} as const
