export function LoadingSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-3"
      aria-busy="true"
      aria-label="Loading Project Gutenberg books"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="aspect-[2/3] w-full animate-pulse rounded-sm bg-stone-100"
        />
      ))}
    </div>
  );
}
