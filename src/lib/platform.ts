export type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

let cached: Platform | null = null;

export function detectPlatform(): Platform {
  if (cached) return cached;
  if (typeof navigator === 'undefined') {
    cached = 'unknown';
    return cached;
  }
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) cached = 'macos';
  else if (ua.includes('win')) cached = 'windows';
  else if (ua.includes('linux')) cached = 'linux';
  else cached = 'unknown';
  return cached;
}

export function revealLabel(): string {
  switch (detectPlatform()) {
    case 'macos':
      return 'Reveal in Finder';
    case 'windows':
      return 'Show in Explorer';
    case 'linux':
      return 'Open in Files';
    default:
      return 'Open folder';
  }
}
