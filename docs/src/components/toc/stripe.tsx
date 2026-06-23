"use client";

import type { TOCItemProps, TOCItemType } from "fumadocs-core/toc";
import * as Primitive from "fumadocs-core/toc";
import { Text } from "lucide-react";
import {
  type ComponentProps,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { I18nLabel, useI18n } from "fumadocs-ui/contexts/i18n";
import { cn } from "@/lib/cn";
import { mergeRefs } from "@/lib/merge-refs";

interface Computed {
  width: number;
  height: number;
  content: ReactNode;
  d: string;
  positions: Position[];
  lengths: Segment[];
}

interface Position {
  item: TOCItemType;
  top: number;
  bottom: number;
  x: number;
}

interface Segment {
  start: number;
  end: number;
}

interface StripeTOCProps {
  items: TOCItemType[];
}

interface StripeTOCItemsProps extends ComponentProps<"div">, StripeTOCProps {
  thumbBox?: boolean;
}

const base = 8;

export function StripeTOC({ items }: StripeTOCProps) {
  return (
    <div
      id="nd-toc"
      className="sticky top-(--fd-docs-row-1) h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] flex flex-col [grid-area:toc] w-(--fd-toc-width) pt-12 pe-4 pb-2 max-xl:hidden"
    >
      <h3
        id="toc-title"
        className="inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground"
      >
        <Text className="size-4" />
        <I18nLabel label="toc" />
      </h3>
      <StripeTOCScrollArea>
        <StripeTOCItems items={items}>
          {items.length === 0 && <StripeTOCEmpty />}
          {items.map((item) => (
            <StripeTOCItem key={item.url} item={item} items={items} />
          ))}
        </StripeTOCItems>
      </StripeTOCScrollArea>
    </div>
  );
}

function StripeTOCScrollArea({ ref, className, ...props }: ComponentProps<"div">) {
  const view = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={mergeRefs(view, ref)}
      className={cn(
        "relative min-h-0 text-sm ms-px overflow-auto [scrollbar-width:none] mask-[linear-gradient(to_bottom,transparent,white_16px,white_calc(100%-16px),transparent)] py-3",
        className,
      )}
      {...props}
    >
      <Primitive.ScrollProvider containerRef={view}>{props.children}</Primitive.ScrollProvider>
    </div>
  );
}

function StripeTOCItems({
  ref,
  className,
  items,
  thumbBox = true,
  children,
  ...props
}: StripeTOCItemsProps) {
  const container = useRef<HTMLDivElement>(null);
  const [computed, setComputed] = useState<Computed | null>(null);

  const compute = useCallback(() => {
    const element = container.current;
    if (!element || element.clientHeight === 0) return;

    if (items.length === 0) {
      setComputed(null);
      return;
    }

    const positions = items.flatMap((item) => {
      const anchor = element.querySelector<HTMLElement>(`a[href="${item.url}"]`);
      if (!anchor) return [];

      const styles = getComputedStyle(anchor);
      const x = getLineOffset(item.depth) + 0.5;
      const top = anchor.offsetTop + parseFloat(styles.paddingTop);
      const bottom = anchor.offsetTop + anchor.clientHeight - parseFloat(styles.paddingBottom);

      return [{ item, top, bottom, x }];
    });

    const width = positions.reduce((value, item) => Math.max(value, item.x + 8), 0);
    const height = positions.reduce((value, item) => Math.max(value, item.bottom), 0);
    const d = positions
      .map((item, index) => {
        if (index === 0) return `M${item.x} ${item.top} L${item.x} ${item.bottom}`;

        const previous = positions[index - 1];
        if (!previous) return "";

        return `C ${previous.x} ${item.top - 4} ${item.x} ${previous.bottom + 4} ${item.x} ${item.top} L${item.x} ${item.bottom}`;
      })
      .join(" ");

    const content = (
      <path key="path" d={d} className="stroke-fd-primary" strokeWidth="1" fill="none" />
    );
    const lengths = thumbBox ? getLengths(d, positions) : [];

    setComputed({ width, height, content, d, positions, lengths });
  }, [items, thumbBox]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const observer = new ResizeObserver(compute);
    observer.observe(element);
    compute();

    return () => {
      observer.disconnect();
    };
  }, [compute]);

  return (
    <div
      ref={mergeRefs(container, ref)}
      className={cn("relative flex flex-col", className)}
      {...props}
    >
      {computed && <StripeThumb computed={computed} thumbBox={thumbBox} />}
      {children}
    </div>
  );
}

function StripeTOCEmpty() {
  const { text } = useI18n();

  return (
    <div className="rounded-lg border bg-fd-card p-3 text-xs text-fd-muted-foreground">
      {text.tocNoHeadings}
    </div>
  );
}

function StripeThumb({ computed, thumbBox }: { computed: Computed; thumbBox: boolean }) {
  const active = Primitive.useActiveAnchors();
  const previous = useRef<{
    start: number;
    end: number;
    isUp: boolean;
  } | null>(null);
  const style = useMemo(() => calculate(computed, active, previous), [active, computed]);

  return (
    <div
      className="absolute top-0 inset-s-0 origin-center rtl:-scale-x-100"
      style={{
        width: computed.width,
        height: computed.height,
        ...style,
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`0 0 ${computed.width} ${computed.height}`}
        className="absolute transition-[clip-path]"
        style={{
          width: computed.width,
          height: computed.height,
          clipPath:
            "polygon(0 var(--track-top,0), 100% var(--track-top,0), 100% var(--track-bottom,0), 0 var(--track-bottom,0))",
        }}
      >
        {computed.content}
      </svg>
      {thumbBox && (
        <div
          className="absolute left-0 size-1 rounded-full bg-fd-primary [offset-distance:var(--offset-distance,0)] opacity-(--opacity,0) transition-[opacity,offset-distance]"
          style={{
            offsetPath: `path("${computed.d}")`,
          }}
        />
      )}
    </div>
  );
}

function StripeTOCItem({
  item,
  items,
  ...props
}: Omit<TOCItemProps, "href"> & { item: TOCItemType; items: TOCItemType[] }) {
  const info = useMemo(() => {
    const index = items.indexOf(item);
    const previous = items[index - 1];
    const next = items[index + 1];
    const current = getLineOffset(item.depth);
    const upper = previous ? getLineOffset(previous.depth) : current;
    const lower = next ? getLineOffset(next.depth) : current;

    return {
      first: index === 0,
      last: index === items.length - 1,
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={cn(
            "absolute -top-1.5 inset-s-0 bottom-0 h-[calc(100%+--spacing(1.5))] -z-1 rtl:-scale-x-100",
            current !== lower && "h-full bottom-1.5",
          )}
          style={{ width: Math.max(upper, current) + 9 }}
        >
          {upper !== current && (
            <path
              d={`M ${upper + 0.5} 0 C ${upper + 0.5} 8 ${current + 0.5} 4 ${current + 0.5} 12`}
              stroke="black"
              strokeWidth="1"
              fill="none"
              className="stroke-fd-foreground/10"
            />
          )}
          <line
            x1={current + 0.5}
            y1={upper === current ? "6" : "12"}
            x2={current + 0.5}
            y2="100%"
            strokeWidth="1"
            className="stroke-fd-foreground/10"
          />
        </svg>
      ),
    };
  }, [items, item]);

  return (
    <Primitive.TOCItem
      href={item.url}
      {...props}
      className={cn(
        "prose relative py-1.5 text-sm scroll-m-4 text-fd-muted-foreground hover:text-fd-accent-foreground transition-colors wrap-anywhere data-[active=true]:text-fd-primary",
        info.first && "pt-0",
        info.last && "pb-0",
        props.className,
      )}
      style={{
        paddingInlineStart: getItemOffset(item.depth),
        ...props.style,
      }}
    >
      {info.svg}
      {item.title}
    </Primitive.TOCItem>
  );
}

function getLengths(d: string, positions: Position[]): Segment[] {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);

  const total = path.getTotalLength();
  const segments: Segment[] = [];

  for (const [index, item] of positions.entries()) {
    let length =
      index > 0
        ? (segments[index - 1]?.end ?? 0) + (item.top - positions[index - 1].bottom)
        : item.top;

    while (length < total && path.getPointAtLength(length).y < item.top) {
      length += 1;
    }

    segments.push({ start: length, end: length + item.bottom - item.top });
  }

  return segments;
}

function calculate(
  computed: Computed,
  active: string[],
  previous: MutableRefObject<{ start: number; end: number; isUp: boolean } | null>,
): Record<string, string> {
  const urls = active.map((item) => `#${item}`);
  const start = computed.positions.findIndex((item) => urls.includes(item.item.url));

  if (start === -1) return {};

  const end = computed.positions.reduce(
    (value, item, index) => (urls.includes(item.item.url) ? index : value),
    -1,
  );
  const first = computed.positions[start];
  const last = computed.positions[end];
  const startSegment = computed.lengths[start];
  const endSegment = computed.lengths[end];

  const isUp = previous.current
    ? previous.current.start > start ||
      previous.current.end > end ||
      (previous.current.start === start && previous.current.end === end && previous.current.isUp)
    : false;

  previous.current = { start, end, isUp };

  return {
    "--track-top": `${first.top}px`,
    "--track-bottom": `${last.bottom}px`,
    "--offset-distance": `${isUp ? (startSegment?.start ?? 0) : (endSegment?.end ?? 0)}px`,
    "--opacity": "1",
  };
}

function getItemOffset(depth: number): number {
  if (depth <= 2) return 12 + base;
  if (depth === 3) return 24 + base;
  return 36 + base;
}

function getLineOffset(depth: number): number {
  if (depth <= 2) return base;
  if (depth === 3) return 8 + base;
  return 16 + base;
}
