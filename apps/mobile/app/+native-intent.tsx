import { railDeepLink } from '@/components/rail/deepLink';

/**
 * Rewrites path-style rail links before routing (plan 13/05):
 * `t816://station/<id>` and `t816://line/<routeId>/<dir>`. Everything else,
 * including bare `t816://` from the Live Activity and widget, passes through
 * unchanged. Never throws: a throw here can crash the launch.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return railDeepLink(path) ?? path;
  } catch {
    return path;
  }
}
