'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

export type VersionCard = {
  id: string;
  label: string;
  title: string;
  summary: string;
  status: string;
};

export type VersionCarouselProps = {
  cards: VersionCard[];
  selectedId: string;
  onSelect: (id: string) => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastTime: number;
  startIndex: number;
  position: number;
  velocity: number;
  moved: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function Arrow({ previous = false }: { previous?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true" style={previous ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VersionCarousel({ cards, selectedId, onSelect }: VersionCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const wheelRef = useRef({ amount: 0, lastStep: 0, lastEvent: 0 });
  const [width, setWidth] = useState(720);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const [interaction, setInteraction] = useState<'pointer' | 'keyboard'>('pointer');
  const instructionsId = useId();
  const selectedIndex = Math.max(0, cards.findIndex((card) => card.id === selectedId));
  const selected = cards[selectedIndex];
  const cardWidth = Math.min(306, Math.max(226, width * 0.42));
  const radius = Math.max(cardWidth * 0.98, width * 0.5);
  const stepPixels = Math.max(170, cardWidth * 0.8);
  const position = dragPosition ?? selectedIndex;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || cards.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || dragRef.current) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const direction = Math.sign(delta);
      const next = clamp(selectedIndex + direction, 0, cards.length - 1);
      if (!direction || next === selectedIndex) return;
      event.preventDefault();
      event.stopPropagation();
      const now = performance.now();
      const wheel = wheelRef.current;
      if (now - wheel.lastEvent > 160 || Math.sign(wheel.amount) !== direction) wheel.amount = 0;
      wheel.lastEvent = now;
      wheel.amount += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? width : 1);
      if (Math.abs(wheel.amount) < 55 || now - wheel.lastStep < 260) return;
      wheel.amount = 0;
      wheel.lastStep = now;
      setInteraction('pointer');
      onSelect(cards[next].id);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [cards, onSelect, selectedIndex, width]);

  const selectIndex = (index: number, keyboard = false) => {
    const next = clamp(index, 0, cards.length - 1);
    if (!cards[next]) return;
    setInteraction(keyboard ? 'keyboard' : 'pointer');
    onSelect(cards[next].id);
    if (keyboard) buttonsRef.current[next]?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    let next: number;
    if (event.key === 'ArrowRight') next = selectedIndex + 1;
    else if (event.key === 'ArrowLeft') next = selectedIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = cards.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    selectIndex(next, true);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || dragRef.current || cards.length < 2) return;
    suppressClickRef.current = false;
    setInteraction('pointer');
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      startIndex: selectedIndex,
      position: selectedIndex,
      velocity: 0,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        dragRef.current = null;
        return;
      }
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      suppressClickRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const now = event.timeStamp;
    const elapsed = Math.max(8, now - drag.lastTime);
    drag.velocity = 0.55 * drag.velocity + 0.45 * (event.clientX - drag.lastX) / elapsed;
    drag.lastX = event.clientX;
    drag.lastTime = now;
    const raw = drag.startIndex - dx / stepPixels;
    const bounded = clamp(raw, 0, cards.length - 1);
    drag.position = bounded + (raw - bounded) * 0.18;
    setDragPosition(drag.position);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved && !cancelled) {
      const velocity = event.timeStamp - drag.lastTime < 100 ? drag.velocity : 0;
      selectIndex(Math.round(drag.position - velocity * 110 / stepPixels));
    }
    setDragPosition(null);
  };

  return (
    <section className="version-carousel" aria-label="Version history" aria-roledescription="carousel" onKeyDown={onKeyDown} data-interaction={interaction}>
      <p className="version-carousel__sr-only" id={instructionsId}>Choose a version. Use left and right arrow keys, swipe horizontally, or scroll over the cards.</p>
      <div
        ref={viewportRef}
        className="version-carousel__viewport"
        data-dragging={dragPosition !== null}
        aria-describedby={instructionsId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finishDrag(event)}
        onPointerCancel={(event) => finishDrag(event, true)}
        onLostPointerCapture={(event) => finishDrag(event, true)}
        onClickCapture={(event) => {
          if (suppressClickRef.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
          }
        }}
      >
        <div className="version-carousel__orbit" aria-hidden="true" />
        {cards.map((card, index) => {
          // Cylindrical placement keeps the same arc and Y rotation as the project wall.
          const distance = clamp(index - position, -3.5, 3.5);
          const angle = distance * 0.66;
          const hidden = Math.abs(index - position) > 2.8;
          const active = index === selectedIndex;
          const style: CSSProperties = {
            width: cardWidth,
            transform: `translate(-50%, -50%) translate3d(${Math.sin(angle) * radius}px, ${Math.abs(distance) * 7}px, ${-radius * (1 - Math.cos(angle))}px) rotateY(${angle * 180 / Math.PI}deg)`,
            opacity: hidden ? 0 : Math.max(0.25, 1 - Math.abs(distance) * 0.29),
            zIndex: 10 - Math.round(Math.abs(distance) * 2),
            pointerEvents: hidden ? 'none' : undefined,
          };
          return (
            <button
              key={card.id}
              ref={(element) => { buttonsRef.current[index] = element; }}
              type="button"
              className="version-carousel__card"
              data-selected={active}
              style={style}
              tabIndex={active ? 0 : -1}
              aria-pressed={active}
              aria-label={`${card.label}: ${card.title}. ${card.status}`}
              aria-hidden={hidden || undefined}
              onClick={(event) => selectIndex(index, event.detail === 0)}
            >
              <span className="version-carousel__card-head"><span>Hyper / Version</span><span className="version-carousel__status">{card.status}</span></span>
              <span className="version-carousel__label" aria-hidden="true">{card.label}</span>
              <span className="version-carousel__rule" aria-hidden="true"><i /><i /><i /></span>
              <span className="version-carousel__title">{card.title}</span>
              <span className="version-carousel__summary">{card.summary}</span>
              <span className="version-carousel__card-foot"><span>{active ? 'Selected version' : 'View version'}</span><Arrow /></span>
            </button>
          );
        })}
        {cards.length === 0 && <p className="version-carousel__empty">Versions will appear here.</p>}
      </div>
      <div className="version-carousel__controls">
        <button className="version-carousel__arrow" type="button" aria-label="Previous version" disabled={selectedIndex === 0 || !cards.length} onClick={(event) => selectIndex(selectedIndex - 1, event.detail === 0)}><Arrow previous /></button>
        <div className="version-carousel__positions" aria-label="Choose a version">
          {cards.map((card, index) => <button key={card.id} className="version-carousel__position" type="button" aria-label={`Select ${card.label}`} aria-pressed={index === selectedIndex} onClick={(event) => selectIndex(index, event.detail === 0)}><span /></button>)}
        </div>
        <button className="version-carousel__arrow" type="button" aria-label="Next version" disabled={selectedIndex >= cards.length - 1} onClick={(event) => selectIndex(selectedIndex + 1, event.detail === 0)}><Arrow /></button>
      </div>
      <span className="version-carousel__sr-only" role="status" aria-live="polite" aria-atomic="true">{selected ? `${selected.label}, ${selected.title}. ${selectedIndex + 1} of ${cards.length}.` : 'No versions yet.'}</span>
    </section>
  );
}

export default VersionCarousel;
