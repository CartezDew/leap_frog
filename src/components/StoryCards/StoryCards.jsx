// Story-telling callout cards used at the top of dashboard pages to give the
// reader an at-a-glance narrative before they dive into the detail tables.
//
// Each card has a tone (purple | green | amber | red | info), an icon, a small
// label, a big headline value, a sentence-length narrative, and a footer line
// that usually expresses share / context for the headline number.
//
// Cards are passed in via the `cards` prop so this component stays reusable —
// the page that hosts it owns the logic that turns analyzer output into
// human-readable story copy.
//
// A card may opt-in to being clickable by setting `to`:
//   - `/some/route`  → renders as a react-router <Link>
//   - `#anchor-id`   → renders as an in-page anchor with smooth scroll

import { Link } from 'react-router-dom';

function scrollToHash(event, hash) {
  if (typeof document === 'undefined') return;
  const id = hash.replace(/^#/, '');
  const el = document.getElementById(id);
  if (!el) return;
  event.preventDefault();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof history !== 'undefined' && history.replaceState) {
    history.replaceState(null, '', `#${id}`);
  }
}

export function StoryCards({ cards, columns = 4, eyebrow, title, ariaLabel }) {
  if (!Array.isArray(cards) || cards.length === 0) return null;

  const label =
    ariaLabel ||
    (typeof eyebrow === 'string' && eyebrow) ||
    (typeof title === 'string' && title) ||
    'Story cards';

  return (
    <section className="story-cards" aria-label={label}>
      {(eyebrow || title) && (
        <header className="story-cards__head">
          {eyebrow && <p className="story-cards__eyebrow">{eyebrow}</p>}
          {title && <h2 className="story-cards__title">{title}</h2>}
        </header>
      )}
      <div
        className={`story-cards__grid story-cards__grid--cols-${columns}`}
      >
        {cards.map((card, idx) => {
          const tone = card.tone || 'purple';
          const Icon = card.icon || null;
          const className = `story-card story-card--${tone}${
            card.to ? ' story-card--link' : ''
          }`;

          const inner = (
            <>
              <header className="story-card__head">
                {Icon && (
                  <span className="story-card__icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                )}
                <span className="story-card__label">{card.label}</span>
              </header>
              <p className="story-card__value">{card.value}</p>
              {card.headline && (
                <p className="story-card__headline">{card.headline}</p>
              )}
              {card.caption && (
                <p className="story-card__caption">{card.caption}</p>
              )}
              {card.footer && (
                <p className="story-card__footer">{card.footer}</p>
              )}
              {card.to && (
                <span className="story-card__cta" aria-hidden="true">
                  {card.ctaLabel || 'View details'}
                  <span className="story-card__cta-arrow">→</span>
                </span>
              )}
            </>
          );

          const ariaCardLabel =
            card.ariaLabel ||
            [card.label, typeof card.headline === 'string' ? card.headline : null]
              .filter(Boolean)
              .join(' — ');

          if (card.to && card.to.startsWith('#')) {
            return (
              <a
                key={card.id || idx}
                href={card.to}
                className={className}
                aria-label={ariaCardLabel || undefined}
                onClick={(e) => scrollToHash(e, card.to)}
              >
                {inner}
              </a>
            );
          }

          if (card.to) {
            return (
              <Link
                key={card.id || idx}
                to={card.to}
                className={className}
                aria-label={ariaCardLabel || undefined}
              >
                {inner}
              </Link>
            );
          }

          return (
            <article key={card.id || idx} className={className}>
              {inner}
            </article>
          );
        })}
      </div>
    </section>
  );
}
