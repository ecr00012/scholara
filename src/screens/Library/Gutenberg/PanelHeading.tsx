import { ArrowUpRight } from 'lucide-react';

export function PanelHeading() {
  return (
    <h2 className="font-serif text-sm leading-snug tracking-tight text-ink">
      Read a new book from{' '}
      <a
        href="https://www.gutenberg.org"
        target="_blank"
        rel="noreferrer"
        className="text-accent-orange underline-offset-2 hover:underline"
      >
        Project Gutenberg
        <ArrowUpRight className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
      </a>
    </h2>
  );
}
