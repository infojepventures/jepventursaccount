/**
 * "Open with JEP Claims" delivers the file as a content:// link, which the router would otherwise try to open
 * as a screen. Send those to the home screen; ShareIntentHandler picks the file up from there.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return /^(content|file):/i.test(path) ? '/' : path;
}
