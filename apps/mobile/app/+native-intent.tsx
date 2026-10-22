import { isBareLink, railDeepLink } from '@/components/rail/deepLink';

/**
 * Rewrites path-style rail links before routing (plan 13/05):
 * `t816://station/<id>` and `t816://line/<routeId>/<dir>`. Bare `t816://`
 * from the Live Activity and widget opens the app where it is: routing it to
 * `/` while running would push a second map over the sheet, so it's dropped
 * (`useSectionLinks` turns the sheet to Nearby). Everything else passes
 * through unchanged. Never throws: a throw here can crash the launch.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (!initial && isBareLink(path)) return null;
    return railDeepLink(path) ?? path;
  } catch {
    return path;
  }
}
