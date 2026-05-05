import { convertFileSrc } from '@tauri-apps/api/core';
import { memo, useEffect, useMemo, useState } from 'react';
import { fnv1a32 } from '../../lib/hash';
import { pickPalette, pickPattern } from '../../lib/coverPalette';
import { ORANGE } from '../../lib/theme';

interface Props {
  title: string;
  author: string | null;
  imageSrc?: string;
  progress?: number | null;
}

function autoFitTitleSize(title: string): number {
  if (title.length <= 14) return 24;
  if (title.length <= 24) return 20;
  if (title.length <= 36) return 16;
  return 14;
}

function PatternFill({
  id,
  pattern,
  color,
}: {
  id: string;
  pattern: string;
  color: string;
}) {
  switch (pattern) {
    case 'paper-grain':
      return (
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width="4"
          height="4"
        >
          <circle cx="1" cy="1" r="0.3" fill={color} fillOpacity="0.06" />
          <circle cx="3" cy="3" r="0.3" fill={color} fillOpacity="0.06" />
        </pattern>
      );
    case 'rule-lines':
      return (
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width="100"
          height="14"
        >
          <line
            x1="0"
            x2="100"
            y1="13"
            y2="13"
            stroke={color}
            strokeOpacity="0.06"
            strokeWidth="0.5"
          />
        </pattern>
      );
    case 'dotted-grid':
      return (
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width="8"
          height="8"
        >
          <circle cx="1" cy="1" r="0.6" fill={color} fillOpacity="0.07" />
        </pattern>
      );
    case 'marbled':
      return (
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width="40"
          height="40"
        >
          <path
            d="M0 20 Q10 10 20 20 T40 20"
            stroke={color}
            strokeOpacity="0.05"
            strokeWidth="0.6"
            fill="none"
          />
        </pattern>
      );
    case 'monogram-S':
      return (
        <pattern
          id={id}
          patternUnits="userSpaceOnUse"
          width="200"
          height="300"
        >
          <text
            x="100"
            y="170"
            textAnchor="middle"
            fontFamily="Iowan Old Style, Georgia, serif"
            fontSize="120"
            fill={color}
            fillOpacity="0.05"
          >
            S
          </text>
        </pattern>
      );
    default:
      return null;
  }
}

function wrapTitle(title: string, maxCharsPerLine: number): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length > maxCharsPerLine && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
    if (lines.length === 2 && line.length > maxCharsPerLine) {
      const ell = line.slice(0, maxCharsPerLine - 1) + '…';
      lines.push(ell);
      return lines.slice(0, 3);
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function GeneratedCoverImpl({ title, author, imageSrc, progress }: Props) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const hash = fnv1a32(title);
  const palette = pickPalette(hash);
  const pattern = pickPattern(hash);
  const patternId = `pat-${pattern}-${hash}`;
  const fontSize = autoFitTitleSize(title);
  const charsPerLine = Math.max(6, Math.floor(180 / (fontSize * 0.55)));
  const lines = wrapTitle(title, charsPerLine);
  const coverSrc = useMemo(
    () => (imageSrc ? convertFileSrc(imageSrc) : null),
    [imageSrc],
  );

  useEffect(() => {
    setImgLoaded(false);
  }, [coverSrc]);

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox="0 0 200 300"
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full rounded-md shadow-sm"
        role="img"
        aria-label={`${title} cover`}
      >
        <defs>
          <PatternFill id={patternId} pattern={pattern} color={palette.ink} />
        </defs>
        <rect width="200" height="300" fill={palette.background} />
        {pattern !== 'plain' && (
          <rect width="200" height="300" fill={`url(#${patternId})`} />
        )}
        <rect x="0" y="28" width="200" height="2" fill={palette.accent} />
        <g
          fontFamily="Iowan Old Style, Palatino Linotype, Georgia, serif"
          fill={palette.ink}
          textAnchor="middle"
        >
          {lines.map((line, i) => (
            <text
              key={i}
              x="100"
              y={90 + i * (fontSize + 4)}
              fontSize={fontSize}
              fontWeight={600}
            >
              {line}
            </text>
          ))}
          {author && (
            <text
              x="100"
              y="240"
              fontSize="12"
              fontStyle="italic"
              fillOpacity="0.7"
            >
              {author}
            </text>
          )}
        </g>
        <line
          x1="40"
          x2="160"
          y1="270"
          y2="270"
          stroke={palette.accent}
          strokeWidth="1"
        />
        <line
          x1="40"
          x2="160"
          y1="274"
          y2="274"
          stroke={palette.accent}
          strokeWidth="0.5"
        />
      </svg>

      {coverSrc && (
        <img
          src={coverSrc}
          alt={`${title} cover`}
          onLoad={() => setImgLoaded(true)}
          className={`absolute inset-0 h-full w-full rounded-md object-cover shadow-sm transition-opacity duration-[250ms] ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          draggable={false}
        />
      )}

      {progress != null && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-stone-200/40">
          <div
            className="h-full transition-[width] duration-300 ease-out"
            style={{
              width: `${Math.round(progress * 100)}%`,
              background: ORANGE,
            }}
          />
        </div>
      )}
    </div>
  );
}

export const GeneratedCover = memo(
  GeneratedCoverImpl,
  (a, b) =>
    a.title === b.title &&
    a.author === b.author &&
    a.imageSrc === b.imageSrc &&
    a.progress === b.progress,
);
